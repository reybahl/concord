"use client";

import { Loader2, Play, Square, Stethoscope, User } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  RoomSimulator,
  type RoomAnalysers,
  type RoomSpeaker,
  type RoomStatus,
} from "@/lib/room-simulator";

interface RoomStartResponse {
  model: string;
  doctor: { token: string; voice: string; persona: string };
  patient: { token: string; voice: string; persona: string };
  doctorBeats: string[];
  patientBeats: string[];
  doctorFree: string;
  patientFree: string;
  patientName: string;
  error?: string;
}

interface Line {
  speaker: RoomSpeaker;
  text: string;
}

const SPEAKER = {
  doctor: { label: "Dr. Reyes", role: "Physician", color: "#38bdf8", Icon: Stethoscope },
  patient: { label: "Patient", role: "In for a follow-up", color: "#34d399", Icon: User },
} as const;

export default function RoomPage() {
  const [status, setStatus] = useState<RoomStatus>("idle");
  const [active, setActive] = useState<RoomSpeaker | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [partial, setPartial] = useState<{ doctor: string; patient: string }>({ doctor: "", patient: "" });
  const [analysers, setAnalysers] = useState<RoomAnalysers | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const simRef = useRef<RoomSimulator | null>(null);
  const running = status !== "idle" && status !== "done";

  useEffect(() => () => simRef.current?.stop(), []);

  const start = useCallback(async () => {
    setStarting(true);
    setError(null);
    setLines([]);
    setPartial({ doctor: "", patient: "" });
    try {
      const res = await fetch("/api/room/start", { method: "POST" });
      const data = (await res.json()) as RoomStartResponse;
      if (!res.ok) throw new Error(data.error ?? "Could not start the room.");

      const sim = new RoomSimulator({
        model: data.model,
        doctor: data.doctor,
        patient: data.patient,
        doctorBeats: data.doctorBeats,
        patientBeats: data.patientBeats,
        doctorFree: data.doctorFree,
        patientFree: data.patientFree,
        onReady: (a) => setAnalysers(a),
        onStatus: (s) => {
          setStatus(s);
          if (s === "doctor" || s === "patient") setActive(s);
        },
        onPartial: (speaker, text) => setPartial((p) => ({ ...p, [speaker]: text })),
        onLine: (speaker, text) => {
          setPartial((p) => ({ ...p, [speaker]: "" }));
          setLines((prev) => [...prev, { speaker, text }]);
        },
        onError: (m) => setError(m),
      });
      simRef.current = sim;
      await sim.start();
    } catch (err) {
      setError((err as Error).message);
      setStatus("idle");
    } finally {
      setStarting(false);
    }
  }, []);

  const stop = useCallback(() => {
    simRef.current?.stop();
    simRef.current = null;
    setStatus("done");
    setActive(null);
    setAnalysers(null);
  }, []);

  return (
    <main className="flex min-h-dvh flex-col bg-gradient-to-b from-background via-background to-muted/20 px-6 py-8">
      <header className="mx-auto w-full max-w-5xl text-center">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Concord — simulated visit
        </p>
        <h1 className="mt-1 text-2xl font-semibold">The exam room</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
          Two AI agents play out a routine follow-up. Keep this tab playing out loud — your Guardian, in the
          other tab, is listening through the microphone and will speak up if anything is unsafe.
        </p>
      </header>

      <section className="mx-auto mt-10 grid w-full max-w-5xl flex-1 grid-cols-1 gap-5 md:grid-cols-2">
        <SpeakerPanel
          who="doctor"
          analyser={analysers?.doctor ?? null}
          active={active === "doctor"}
          partial={partial.doctor}
        />
        <SpeakerPanel
          who="patient"
          analyser={analysers?.patient ?? null}
          active={active === "patient"}
          partial={partial.patient}
        />
      </section>

      <div className="mx-auto mt-8 flex w-full max-w-5xl flex-col items-center gap-4">
        {running ? (
          <Button size="lg" variant="outline" onClick={stop}>
            <Square /> Stop visit
          </Button>
        ) : (
          <Button size="lg" onClick={start} disabled={starting}>
            {starting ? <Loader2 className="animate-spin" /> : <Play />}
            {starting ? "Connecting…" : "Start visit"}
          </Button>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>

      <Transcript lines={lines} />
    </main>
  );
}

function SpeakerPanel({
  who,
  analyser,
  active,
  partial,
}: {
  who: RoomSpeaker;
  analyser: AnalyserNode | null;
  active: boolean;
  partial: string;
}) {
  const { label, role, color, Icon } = SPEAKER[who];
  return (
    <div
      className={`relative flex flex-col items-center overflow-hidden rounded-2xl border bg-card/60 p-8 transition-colors ${
        active ? "border-foreground/20" : "border-border/60"
      }`}
      style={active ? { boxShadow: `0 0 0 1px ${color}33, 0 0 60px -20px ${color}` } : undefined}
    >
      <div
        className="flex size-16 items-center justify-center rounded-full transition-transform"
        style={{
          background: `${color}1a`,
          color,
          transform: active ? "scale(1.05)" : "scale(1)",
        }}
      >
        <Icon className="size-7" />
      </div>
      <p className="mt-4 text-lg font-semibold">{label}</p>
      <p className="text-xs text-muted-foreground">{role}</p>

      <Waveform analyser={analyser} color={color} active={active} />

      <p className="mt-2 line-clamp-3 min-h-[3.75rem] text-center text-sm text-muted-foreground">
        {partial || (active ? "…" : "")}
      </p>
    </div>
  );
}

function Waveform({ analyser, color, active }: { analyser: AnalyserNode | null; color: string; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;
    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;
    ctx.scale(dpr, dpr);

    const data = analyser ? new Uint8Array(analyser.fftSize) : null;
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, cssWidth, cssHeight);
      const mid = cssHeight / 2;

      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.globalAlpha = active ? 1 : 0.35;
      ctx.beginPath();

      if (analyser && data) {
        analyser.getByteTimeDomainData(data);
        const step = cssWidth / data.length;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128; // -1..1
          const y = mid + v * mid * 0.9;
          const x = i * step;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      } else {
        ctx.moveTo(0, mid);
        ctx.lineTo(cssWidth, mid);
      }
      ctx.stroke();
    };

    draw();
    return () => cancelAnimationFrame(raf);
  }, [analyser, color, active]);

  return <canvas ref={canvasRef} className="mt-6 h-20 w-full" />;
}

function Transcript({ lines }: { lines: Line[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [lines]);

  if (lines.length === 0) return null;
  return (
    <div className="mx-auto mt-10 w-full max-w-2xl space-y-3 rounded-xl border border-border/50 bg-card/40 p-5">
      {lines.map((line, i) => {
        const { label, color } = SPEAKER[line.speaker];
        return (
          <div key={i} className="flex gap-3 text-sm">
            <span className="mt-0.5 w-20 shrink-0 text-right text-[11px] font-medium" style={{ color }}>
              {label}
            </span>
            <span className="leading-6">{line.text}</span>
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
