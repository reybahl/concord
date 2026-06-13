/**
 * Browser-side client for the xAI Voice Agent (Realtime) API, configured as a
 * SILENT guardian.
 *
 * Hard guarantee: the guardian is audibly silent unless WE decide otherwise.
 * The xAI server auto-generates a spoken response for every turn and will read
 * its own instructions aloud if allowed — so we never rely on prompt/turn
 * settings to keep it quiet. Instead the client drops ALL model-generated audio
 * and only ever plays a `force_message` that we explicitly sanction (a conflict
 * warning, or a grounded answer when the patient addresses it directly).
 *
 * The realtime model is therefore used only for VAD + transcription; every word
 * spoken aloud is produced deliberately, server-side and grounded in the record.
 */

const REALTIME_URL = "wss://api.x.ai/v1/realtime";
const SAMPLE_RATE = 24000;

export type GuardianStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "speaking"
  | "thinking"
  | "error"
  | "closed";

export type UtteranceDecision = { mode: "speak"; text: string } | { mode: "silent" };

export type CaptureSource = "mic" | "tab";

export interface GuardianSessionConfig {
  token: string;
  model: string;
  voice: string;
  instructions: string;
  /**
   * Where the room audio comes from. "mic" listens through the microphone (the
   * real-world story); "tab" captures another browser tab's audio directly via
   * getDisplayMedia — a clean digital feed with no echo, ideal for demos.
   */
  captureSource?: CaptureSource;
  onStatus?: (status: GuardianStatus) => void;
  onTranscript?: (role: "room" | "guardian", text: string, final: boolean) => void;
  /** Decide what to do with a finalized room utterance. Runs the grounded check. */
  onRoomUtterance: (text: string) => Promise<UtteranceDecision>;
  onError?: (message: string) => void;
}

export class GuardianSession {
  private ws: WebSocket | null = null;
  private micCtx: AudioContext | null = null;
  private playCtx: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;

  private playbackTime = 0;
  private roomBuffer = "";
  private guardianBuffer = "";
  private lastRoomFinal = "";
  private closed = false;

  // Speech control: nothing plays unless it belongs to a response we sanctioned.
  private sanctionedResponseId: string | null = null;
  private awaitingSanctioned = false;
  private guardianSpeaking = false;
  private assessing = false;

  constructor(private readonly config: GuardianSessionConfig) {}

  async start(): Promise<void> {
    this.setStatus("connecting");
    await this.initMic();

    const ws = new WebSocket(`${REALTIME_URL}?model=${encodeURIComponent(this.config.model)}`, [
      `xai-client-secret.${this.config.token}`,
    ]);
    this.ws = ws;

    ws.addEventListener("open", () => this.onOpen());
    ws.addEventListener("message", (e) => this.onMessage(e));
    ws.addEventListener("error", () => this.fail("Voice connection error."));
    ws.addEventListener("close", () => {
      if (!this.closed) this.setStatus("closed");
    });
  }

  stop(): void {
    this.closed = true;
    this.processor?.disconnect();
    this.micSource?.disconnect();
    this.micStream?.getTracks().forEach((t) => t.stop());
    void this.micCtx?.close().catch(() => undefined);
    void this.playCtx?.close().catch(() => undefined);
    this.ws?.close();
    this.processor = null;
    this.micSource = null;
    this.micStream = null;
    this.micCtx = null;
    this.playCtx = null;
    this.ws = null;
    this.setStatus("idle");
  }

  // --- setup ----------------------------------------------------------------

  private async initMic(): Promise<void> {
    const Ctx: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

    this.micCtx = new Ctx({ sampleRate: SAMPLE_RATE });
    this.playCtx = new Ctx({ sampleRate: SAMPLE_RATE });
    this.playbackTime = this.playCtx.currentTime;

    this.micStream = await this.captureStream();
    this.micSource = this.micCtx.createMediaStreamSource(this.micStream);
    this.processor = this.micCtx.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (e) => this.onMicFrame(e.inputBuffer.getChannelData(0));

    const sink = this.micCtx.createGain();
    sink.gain.value = 0;
    this.micSource.connect(this.processor);
    this.processor.connect(sink);
    sink.connect(this.micCtx.destination);
  }

  /** Acquire the room audio stream: the microphone, or another tab's audio. */
  private async captureStream(): Promise<MediaStream> {
    if (this.config.captureSource === "tab") {
      // getDisplayMedia needs video to offer the "share tab audio" checkbox; we
      // keep only the audio track and discard the video.
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const [audioTrack] = display.getAudioTracks();
      if (!audioTrack) {
        display.getTracks().forEach((t) => t.stop());
        throw new Error('No tab audio. Pick the room tab and enable "Share tab audio".');
      }
      display.getVideoTracks().forEach((t) => t.stop());
      return new MediaStream([audioTrack]);
    }

    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  }

  private onOpen(): void {
    this.send({
      type: "session.update",
      session: {
        voice: this.config.voice,
        instructions: this.config.instructions,
        // Server VAD gives reliable transcription + turn boundaries. We do NOT
        // rely on it for silence — that is enforced by the playback gate below.
        // A longer silence window keeps whole sentences together so the
        // classifier sees a complete order (e.g. "...put you on amoxicillin")
        // instead of fragments.
        turn_detection: { type: "server_vad", silence_duration_ms: 900, prefix_padding_ms: 300 },
        audio: {
          input: {
            format: { type: "audio/pcm", rate: SAMPLE_RATE },
            transcription: { model: "grok-transcribe", language_hint: "en" },
          },
          output: { format: { type: "audio/pcm", rate: SAMPLE_RATE } },
        },
      },
    });
    this.setStatus("listening");
  }

  // --- audio in -------------------------------------------------------------

  private onMicFrame(samples: Float32Array): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    // Don't feed the server while the guardian is speaking (prevents it from
    // hearing its own voice) or while an assessment is in flight (prevents
    // overlapping turns mid-decision).
    if (this.guardianSpeaking || this.assessing) return;
    this.send({ type: "input_audio_buffer.append", audio: floatToBase64PCM16(samples) });
  }

  // --- audio out ------------------------------------------------------------

  private playAudio(base64: string): void {
    if (!this.playCtx) return;
    const float = base64PCM16ToFloat32(base64);
    if (float.length === 0) return;

    const buffer = this.playCtx.createBuffer(1, float.length, SAMPLE_RATE);
    buffer.getChannelData(0).set(float);
    const source = this.playCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.playCtx.destination);

    const startAt = Math.max(this.playCtx.currentTime, this.playbackTime);
    source.start(startAt);
    this.playbackTime = startAt + buffer.duration;
  }

  // --- events ---------------------------------------------------------------

  private onMessage(e: MessageEvent): void {
    let event: Record<string, unknown> & { type?: string };
    try {
      event = JSON.parse(typeof e.data === "string" ? e.data : "");
    } catch {
      return;
    }

    switch (event.type) {
      case "response.created": {
        // Tie the next response to our sanction (if we just asked it to speak).
        if (this.awaitingSanctioned) {
          this.sanctionedResponseId = responseId(event);
          this.awaitingSanctioned = false;
        }
        break;
      }
      case "response.output_audio.delta": {
        if (this.isSanctioned(event) && typeof event.delta === "string") {
          this.guardianSpeaking = true;
          this.setStatus("speaking");
          this.playAudio(event.delta);
        }
        // Unsanctioned audio (the model talking on its own) is silently dropped.
        break;
      }
      case "conversation.item.input_audio_transcription.updated": {
        const text = readText(event);
        if (text) this.config.onTranscript?.("room", (this.roomBuffer = text), false);
        break;
      }
      case "conversation.item.input_audio_transcription.completed": {
        const text = (readText(event) || this.roomBuffer).trim();
        this.roomBuffer = "";
        // The server can emit a duplicate "completed" for the same turn; ignore
        // it so we neither show it twice nor re-run the assessment.
        if (text && text !== this.lastRoomFinal) {
          this.lastRoomFinal = text;
          this.config.onTranscript?.("room", text, true);
          void this.handleRoomUtterance(text);
        }
        break;
      }
      case "response.output_audio_transcript.delta": {
        if (this.isSanctioned(event) && typeof event.delta === "string") {
          this.guardianBuffer += event.delta;
          this.config.onTranscript?.("guardian", this.guardianBuffer, false);
        }
        break;
      }
      case "response.output_audio_transcript.done": {
        if (this.isSanctioned(event)) {
          const text = readText(event) || this.guardianBuffer;
          if (text) this.config.onTranscript?.("guardian", text, true);
        }
        this.guardianBuffer = "";
        break;
      }
      case "response.done": {
        if (this.isSanctioned(event)) this.endSanctionedSpeech();
        break;
      }
      case "error": {
        this.fail(readErrorMessage(event));
        break;
      }
    }
  }

  /** A response is sanctioned only if it's the one we explicitly asked to speak. */
  private isSanctioned(event: Record<string, unknown>): boolean {
    const id = responseId(event);
    if (this.sanctionedResponseId !== null) return id === this.sanctionedResponseId;
    // Fall back to the intent flag if the server omits a response id.
    return id === null && this.awaitingSanctioned === false && this.guardianSpeaking;
  }

  private endSanctionedSpeech(): void {
    // Audio is scheduled into the future; stay "speaking" until playback ends so
    // the mic stays muted and never captures the guardian's own tail.
    const remainingMs = this.playCtx ? Math.max(0, (this.playbackTime - this.playCtx.currentTime) * 1000) : 0;
    window.setTimeout(() => {
      this.guardianSpeaking = false;
      this.sanctionedResponseId = null;
      if (!this.closed) this.setStatus("listening");
    }, remainingMs + 250);
  }

  private async handleRoomUtterance(text: string): Promise<void> {
    this.assessing = true;
    this.setStatus("thinking");
    let decision: UtteranceDecision;
    try {
      decision = await this.config.onRoomUtterance(text);
    } catch (err) {
      this.config.onError?.((err as Error).message);
      decision = { mode: "silent" };
    } finally {
      this.assessing = false;
    }

    if (decision.mode === "speak" && decision.text.trim()) {
      this.speak(decision.text.trim());
    } else if (!this.closed && !this.guardianSpeaking) {
      this.setStatus("listening");
    }
  }

  private speak(text: string): void {
    // Mark the next response as sanctioned and mute the mic immediately.
    this.awaitingSanctioned = true;
    this.guardianSpeaking = true;
    this.setStatus("speaking");
    this.send({
      type: "conversation.item.create",
      item: {
        type: "force_message",
        role: "assistant",
        interruptible: false,
        content: [{ type: "output_text", text }],
      },
    });
  }

  // --- helpers --------------------------------------------------------------

  private send(payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
  }

  private setStatus(status: GuardianStatus): void {
    this.config.onStatus?.(status);
  }

  private fail(message: string): void {
    this.config.onError?.(message);
    this.setStatus("error");
  }
}

function responseId(event: Record<string, unknown>): string | null {
  if (typeof event.response_id === "string") return event.response_id;
  const response = event.response;
  if (response && typeof response === "object" && typeof (response as { id?: unknown }).id === "string") {
    return (response as { id: string }).id;
  }
  return null;
}

function readText(event: Record<string, unknown>): string {
  if (typeof event.transcript === "string") return event.transcript;
  if (typeof event.text === "string") return event.text;
  return "";
}

function readErrorMessage(event: Record<string, unknown>): string {
  const err = event.error;
  if (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return "Voice session error.";
}

function floatToBase64PCM16(float32: Float32Array): string {
  const pcm16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(pcm16.buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64PCM16ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const pcm16 = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
  const float32 = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768;
  return float32;
}
