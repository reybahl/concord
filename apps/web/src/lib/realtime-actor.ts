/**
 * A speak-only xAI Voice Agent connection used for the simulated visit demo.
 *
 * Unlike the Guardian (which listens to a mic), an actor is driven entirely by
 * text: you tell it what the other speaker said (`hear`) and ask it to produce
 * its next spoken line (`generate`). It plays the resulting audio and resolves
 * with the transcript once playback finishes, so turns can be cleanly
 * serialized into a back-and-forth conversation.
 *
 * All actors share one AudioContext + playback cursor so no two voices overlap.
 */

const REALTIME_URL = "wss://api.x.ai/v1/realtime";
const SAMPLE_RATE = 24000;

export interface SharedPlayback {
  ctx: AudioContext;
  get: () => number;
  set: (t: number) => void;
}

export interface RealtimeActorConfig {
  token: string;
  model: string;
  voice: string;
  instructions: string;
  shared: SharedPlayback;
  /** Node to route this actor's audio through (e.g. a per-actor AnalyserNode). Defaults to ctx.destination. */
  outputNode?: AudioNode;
  onTranscriptDelta?: (cumulative: string) => void;
  onError?: (message: string) => void;
}

interface Turn {
  resolve: (transcript: string) => void;
  transcript: string;
  endsAt: number;
}

export class RealtimeActor {
  private ws: WebSocket | null = null;
  private turn: Turn | null = null;
  private closed = false;
  private readyResolve: (() => void) | null = null;

  constructor(private readonly config: RealtimeActorConfig) {}

  async connect(): Promise<void> {
    const ready = new Promise<void>((resolve) => {
      this.readyResolve = resolve;
    });

    const ws = new WebSocket(`${REALTIME_URL}?model=${encodeURIComponent(this.config.model)}`, [
      `xai-client-secret.${this.config.token}`,
    ]);
    this.ws = ws;

    ws.addEventListener("open", () => this.onOpen());
    ws.addEventListener("message", (e) => this.onMessage(e));
    ws.addEventListener("error", () => this.config.onError?.("Voice connection error."));
    ws.addEventListener("close", () => this.finishTurnImmediately());

    // Fallback in case the server does not echo session.updated.
    const timer = window.setTimeout(() => this.readyResolve?.(), 2500);
    await ready;
    window.clearTimeout(timer);
  }

  /** Add the other speaker's line to this actor's conversation history. */
  hear(text: string): void {
    if (!text.trim()) return;
    this.send({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text }] },
    });
  }

  /** Produce the next spoken line. `instructions` overrides the persona for this turn. */
  generate(instructions?: string): Promise<string> {
    const promise = this.startTurn();
    this.send({
      type: "response.create",
      ...(instructions ? { response: { instructions } } : {}),
    });
    return promise;
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
    this.finishTurnImmediately();
  }

  // --- internals ------------------------------------------------------------

  private startTurn(): Promise<string> {
    return new Promise<string>((resolve) => {
      this.turn = { resolve, transcript: "", endsAt: this.config.shared.get() };
    });
  }

  private onOpen(): void {
    this.send({
      type: "session.update",
      session: {
        voice: this.config.voice,
        instructions: this.config.instructions,
        turn_detection: null,
        audio: {
          input: { format: { type: "audio/pcm", rate: SAMPLE_RATE } },
          output: { format: { type: "audio/pcm", rate: SAMPLE_RATE } },
        },
      },
    });
  }

  private onMessage(e: MessageEvent): void {
    let event: Record<string, unknown> & { type?: string };
    try {
      event = JSON.parse(typeof e.data === "string" ? e.data : "");
    } catch {
      return;
    }

    switch (event.type) {
      case "session.updated":
      case "session.created":
        this.readyResolve?.();
        break;
      case "response.output_audio.delta":
        if (typeof event.delta === "string") this.playAudio(event.delta);
        break;
      case "response.output_audio_transcript.delta":
        if (this.turn && typeof event.delta === "string") {
          this.turn.transcript += event.delta;
          this.config.onTranscriptDelta?.(this.turn.transcript);
        }
        break;
      case "response.done":
        this.finishTurn();
        break;
      case "error":
        this.config.onError?.(readErrorMessage(event));
        this.finishTurn();
        break;
    }
  }

  private playAudio(base64: string): void {
    const { ctx, get, set } = this.config.shared;
    const float = base64PCM16ToFloat32(base64);
    if (float.length === 0) return;

    const buffer = ctx.createBuffer(1, float.length, SAMPLE_RATE);
    buffer.getChannelData(0).set(float);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.config.outputNode ?? ctx.destination);

    const startAt = Math.max(ctx.currentTime, get());
    source.start(startAt);
    const endsAt = startAt + buffer.duration;
    set(endsAt);
    if (this.turn) this.turn.endsAt = endsAt;
  }

  /** Resolve the in-flight turn once scheduled playback has actually finished. */
  private finishTurn(): void {
    const turn = this.turn;
    if (!turn) return;
    this.turn = null;
    const remainingMs = Math.max(0, (turn.endsAt - this.config.shared.ctx.currentTime) * 1000);
    window.setTimeout(() => turn.resolve(turn.transcript.trim()), remainingMs + 150);
  }

  private finishTurnImmediately(): void {
    const turn = this.turn;
    if (!turn) return;
    this.turn = null;
    turn.resolve(turn.transcript.trim());
  }

  private send(payload: unknown): void {
    if (!this.closed && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
  }
}

function readErrorMessage(event: Record<string, unknown>): string {
  const err = event.error;
  if (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return "Voice session error.";
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
