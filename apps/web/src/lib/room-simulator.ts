import { RealtimeActor, type SharedPlayback } from "./realtime-actor";

/**
 * Drives the standalone "exam room" demo: a doctor agent and a patient agent
 * converse aloud (each with its own voice), serialized so exactly one voice
 * plays at a time. There is NO Guardian here — the room is deliberately deaf to
 * it. The Guardian runs in a separate tab and hears this conversation through
 * the microphone, exactly as it would in a real room.
 *
 * Each actor's audio is routed through its own AnalyserNode so the UI can draw
 * a live waveform per speaker.
 */

export type RoomSpeaker = "doctor" | "patient";
export type RoomStatus = "connecting" | RoomSpeaker | "idle" | "done";

/** Native xAI TTS speed for the simulated visit so demos move along (pitch-preserving). */
const OUTPUT_SPEED = 1.25;

export interface RoomAnalysers {
  doctor: AnalyserNode;
  patient: AnalyserNode;
}

export interface RoomSimulatorConfig {
  model: string;
  doctor: { token: string; voice: string; persona: string };
  patient: { token: string; voice: string; persona: string };
  doctorBeats: string[];
  patientBeats: string[];
  doctorFree: string;
  patientFree: string;

  onLine: (speaker: RoomSpeaker, text: string) => void;
  onPartial?: (speaker: RoomSpeaker, text: string) => void;
  onStatus?: (status: RoomStatus) => void;
  /** Fired once the AudioContext + per-speaker analysers exist, so the UI can draw. */
  onReady?: (analysers: RoomAnalysers) => void;
  onError?: (message: string) => void;
}

export class RoomSimulator {
  private ctx: AudioContext | null = null;
  private playbackTime = 0;
  private doctor: RealtimeActor | null = null;
  private patient: RealtimeActor | null = null;
  private running = false;
  /** The most recent line, used to relay context to the other speaker. */
  private lastLine: { speaker: RoomSpeaker; text: string } | null = null;

  constructor(private readonly config: RoomSimulatorConfig) {}

  async start(): Promise<void> {
    this.config.onStatus?.("connecting");

    const Ctx: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx({ sampleRate: 24000 });
    this.playbackTime = this.ctx.currentTime;
    const shared: SharedPlayback = {
      ctx: this.ctx,
      get: () => this.playbackTime,
      set: (t) => {
        this.playbackTime = t;
      },
    };

    const doctorAnalyser = makeAnalyser(this.ctx);
    const patientAnalyser = makeAnalyser(this.ctx);
    this.config.onReady?.({ doctor: doctorAnalyser, patient: patientAnalyser });

    const onError = (m: string) => this.config.onError?.(m);

    this.doctor = new RealtimeActor({
      token: this.config.doctor.token,
      model: this.config.model,
      voice: this.config.doctor.voice,
      instructions: this.config.doctor.persona,
      shared,
      outputNode: doctorAnalyser,
      outputSpeed: OUTPUT_SPEED,
      onTranscriptDelta: (t) => this.config.onPartial?.("doctor", t),
      onError,
    });
    this.patient = new RealtimeActor({
      token: this.config.patient.token,
      model: this.config.model,
      voice: this.config.patient.voice,
      instructions: this.config.patient.persona,
      shared,
      outputNode: patientAnalyser,
      outputSpeed: OUTPUT_SPEED,
      onTranscriptDelta: (t) => this.config.onPartial?.("patient", t),
      onError,
    });

    await Promise.all([this.doctor.connect(), this.patient.connect()]);

    this.running = true;
    void this.loop();
  }

  stop(): void {
    this.running = false;
    this.doctor?.close();
    this.patient?.close();
    void this.ctx?.close().catch(() => undefined);
    this.doctor = this.patient = null;
    this.ctx = null;
    this.config.onStatus?.("done");
  }

  private async loop(): Promise<void> {
    const rounds = Math.max(this.config.doctorBeats.length, this.config.patientBeats.length);
    let round = 0;
    while (this.running && round < rounds) {
      await this.turn("doctor", this.doctor!, this.config.doctorBeats[round] ?? this.config.doctorFree);
      if (!this.running) break;
      await this.turn("patient", this.patient!, this.config.patientBeats[round] ?? this.config.patientFree);
      round += 1;
    }
    if (this.running) this.stop();
  }

  /** One speaker turn: relay the other speaker's last line, then generate + speak. */
  private async turn(who: RoomSpeaker, actor: RealtimeActor, directive: string): Promise<void> {
    if (this.lastLine && this.lastLine.speaker !== who) {
      actor.hear(attribute(this.lastLine));
    }
    this.config.onStatus?.(who);

    const line = await actor.generate(directive);
    if (!this.running || !line) return;

    this.config.onLine(who, line);
    this.lastLine = { speaker: who, text: line };
  }
}

function makeAnalyser(ctx: AudioContext): AnalyserNode {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.75;
  analyser.connect(ctx.destination);
  return analyser;
}

function attribute(line: { speaker: RoomSpeaker; text: string }): string {
  return line.speaker === "doctor" ? `The doctor said: ${line.text}` : `The patient said: ${line.text}`;
}
