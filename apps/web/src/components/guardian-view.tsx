"use client";

import {
  AudioLines,
  CheckCircle2,
  Ear,
  ExternalLink,
  Loader2,
  Mic,
  Save,
  ShieldAlert,
  ShieldCheck,
  Square,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { GuardianVerdict } from "@/lib/guardian";
import {
  type CaptureSource,
  GuardianSession,
  type GuardianStatus,
  type UtteranceDecision,
} from "@/lib/realtime-guardian";
import type { HealthRecord } from "@/lib/types";

interface StartResponse {
  token: string;
  model: string;
  voice: string;
  instructions: string;
  patientName: string;
  error?: string;
}

interface AssessmentEvent {
  id: string;
  action: string;
  quote: string | null;
  status: "clear" | "flagged";
  verdict?: GuardianVerdict;
}

interface TranscriptTurn {
  role: "room" | "guardian";
  text: string;
  /** Stable id for room lines so revisions update in place instead of appending. */
  key?: string;
}

const SEV: Record<string, { label: string; cls: string }> = {
  high: { label: "High risk", cls: "border-red-500/40 bg-red-500/10 text-red-300" },
  medium: { label: "Medium risk", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  low: { label: "Low risk", cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  none: { label: "Clear", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
};

const STATUS_LABEL: Record<GuardianStatus, string> = {
  idle: "Idle",
  connecting: "Connecting…",
  listening: "Listening to the room",
  speaking: "Speaking up",
  thinking: "Checking the record…",
  error: "Error",
  closed: "Session ended",
};

export function GuardianView({
  record,
  onLearned,
  onGoToUpload,
}: {
  record: HealthRecord | null;
  onLearned: () => void;
  onGoToUpload: () => void;
}) {
  const [status, setStatus] = useState<GuardianStatus>("idle");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<AssessmentEvent[]>([]);
  const [committed, setCommitted] = useState<TranscriptTurn[]>([]);
  const [liveRoom, setLiveRoom] = useState("");
  const [liveGuardian, setLiveGuardian] = useState("");
  const [learning, setLearning] = useState(false);
  const [learned, setLearned] = useState<string | null>(null);
  const [captureSource, setCaptureSource] = useState<CaptureSource>("mic");

  const sessionRef = useRef<GuardianSession | null>(null);

  const active = status !== "idle" && status !== "closed" && status !== "error";

  useEffect(() => {
    return () => sessionRef.current?.stop();
  }, []);

  const assess = useCallback(async (utterance: string): Promise<UtteranceDecision> => {
    try {
      const res = await fetch("/api/guardian/assess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ utterance }),
      });
      const data = (await res.json()) as {
        answer?: string;
        clinical?: boolean;
        verdict?: GuardianVerdict;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Assessment failed.");

      // The patient addressed the guardian directly — speak the grounded answer.
      if (data.answer?.trim()) return { mode: "speak", text: data.answer };

      // Ordinary conversation — stay silent, don't clutter the log.
      if (!data.clinical || !data.verdict) return { mode: "silent" };

      const verdict = data.verdict;
      setEvents((prev) => [
        {
          id: crypto.randomUUID(),
          action: verdict.proposedAction || utterance,
          quote: utterance,
          status: verdict.conflict ? "flagged" : "clear",
          verdict,
        },
        ...prev,
      ]);

      if (verdict.conflict && verdict.spokenWarning.trim()) {
        return { mode: "speak", text: verdict.spokenWarning };
      }
      return { mode: "silent" };
    } catch (err) {
      setError((err as Error).message);
      return { mode: "silent" };
    }
  }, []);

  async function startSession() {
    if (!record) return;
    setStarting(true);
    setError(null);
    setLearned(null);

    try {
      const res = await fetch("/api/guardian/start", { method: "POST" });
      const data = (await res.json()) as StartResponse;
      if (!res.ok) throw new Error(data.error ?? "Could not start the Guardian.");

      const session = new GuardianSession({
        token: data.token,
        model: data.model,
        voice: data.voice,
        instructions: data.instructions,
        captureSource,
        onStatus: setStatus,
        onError: (m) => setError(m),
        onRoomUtterance: assess,
        onTranscript: (role, text, final, key) => {
          if (!final) {
            if (role === "room") setLiveRoom(text);
            else setLiveGuardian(text);
            return;
          }

          if (role === "room") setLiveRoom("");
          else setLiveGuardian("");

          // Keyed room lines update in place (and an empty text removes the line).
          if (role === "room" && key) {
            setCommitted((prev) => {
              const idx = prev.findIndex((t) => t.key === key);
              if (idx === -1) return text.trim() ? [...prev, { role, text, key }] : prev;
              if (!text.trim()) return prev.filter((_, i) => i !== idx);
              const next = [...prev];
              next[idx] = { role, text, key };
              return next;
            });
            return;
          }

          if (text.trim()) setCommitted((prev) => [...prev, { role, text }]);
        },
      });

      sessionRef.current = session;
      await session.start();
    } catch (err) {
      setError((err as Error).message);
      setStatus("error");
    } finally {
      setStarting(false);
    }
  }

  function endSession() {
    sessionRef.current?.stop();
    sessionRef.current = null;
    setStatus("closed");
    setLiveRoom("");
    setLiveGuardian("");
  }

  async function saveVisit() {
    const transcript = committed;
    if (transcript.length === 0) return;
    setLearning(true);
    setError(null);
    try {
      const res = await fetch("/api/guardian/learn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript }),
      });
      const data = (await res.json()) as { document?: { filename: string }; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not save the visit.");
      setLearned(data.document?.filename ?? "visit saved");
      onLearned();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLearning(false);
    }
  }

  if (!record) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-medium tracking-tight">Guardian</CardTitle>
          <CardDescription className="max-w-2xl text-[13px] leading-6">
            The Guardian listens to a live visit and speaks up the moment a clinician proposes something
            unsafe given your reconciled record — the catch no single provider could make. Reconcile a
            record first so it knows what to protect.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={onGoToUpload}>
            Upload &amp; reconcile records
          </Button>
        </CardContent>
      </Card>
    );
  }

  const flagged = events.filter((e) => e.status === "flagged");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg font-medium tracking-tight">
            <ShieldCheck className="size-5 text-emerald-300" /> Guardian
          </CardTitle>
          <CardDescription className="max-w-2xl text-[13px] leading-6">
            A point-of-care safety layer for {record.patient.name}. It stays silent, listens to the room,
            and interrupts only when a proposed medication or order conflicts with the reconciled,
            cross-provider record. Open the simulated room in another tab to hear a doctor and patient
            talk it through while the Guardian listens.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          {!active ? (
            <>
              <SourceToggle value={captureSource} onChange={setCaptureSource} disabled={starting} />
              <Button onClick={startSession} disabled={starting}>
                {starting ? <Loader2 className="animate-spin" /> : captureSource === "tab" ? <AudioLines /> : <Mic />}
                {starting ? "Starting…" : "Start listening"}
              </Button>
              <Button variant="outline" onClick={() => window.open("/room", "_blank", "noopener")}>
                <ExternalLink /> Open simulated room
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={endSession}>
              <Square /> End visit
            </Button>
          )}
          <StatusPill status={status} />
          {committed.length > 0 && !active && (
            <Button variant="outline" onClick={saveVisit} disabled={learning}>
              {learning ? <Loader2 className="animate-spin" /> : <Save />}
              Save visit to record
            </Button>
          )}
        </CardContent>
      </Card>

      {error && (
        <Alert className="border-red-500/40 text-red-300">
          <AlertTitle>Guardian error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {learned && (
        <Alert className="border-emerald-500/40 text-emerald-300">
          <AlertTitle>Visit folded into the record</AlertTitle>
          <AlertDescription>
            Saved as <span className="font-mono">{learned}</span>. Re-run reconciliation to merge this visit
            into the longitudinal record.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-4">
          {flagged.map((e) => e.verdict && <CatchCard key={e.id} verdict={e.verdict} record={record} />)}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AudioLines className="size-4 text-muted-foreground" /> Live transcript
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Transcript committed={committed} liveRoom={liveRoom} liveGuardian={liveGuardian} active={active} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <HoldingPanel record={record} />
          <AssessmentLog events={events} />
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: GuardianStatus }) {
  const tone =
    status === "speaking"
      ? "border-red-500/40 text-red-300"
      : status === "thinking"
        ? "border-amber-500/40 text-amber-300"
        : status === "listening"
          ? "border-emerald-500/40 text-emerald-300"
          : "text-muted-foreground";
  const Icon = status === "listening" ? Ear : status === "speaking" ? AudioLines : status === "thinking" ? Loader2 : ShieldCheck;
  return (
    <Badge variant="outline" className={`gap-1.5 ${tone}`}>
      <Icon className={`size-3.5 ${status === "thinking" ? "animate-spin" : ""}`} />
      {STATUS_LABEL[status]}
    </Badge>
  );
}

function CatchCard({ verdict, record }: { verdict: GuardianVerdict; record: HealthRecord }) {
  const sev = SEV[verdict.severity] ?? SEV.medium;
  const sourceCount = record.sources.length;
  const involved = new Set(verdict.conflictingFacts.map((f) => f.sourceLabel));

  return (
    <Card className={`border-2 ${sev.cls.split(" ")[0]}`}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className={`size-5 ${sev.cls.split(" ").at(-1)}`} />
            Guardian caught a conflict
          </CardTitle>
          <Badge variant="outline" className={sev.cls}>
            {sev.label}
          </Badge>
        </div>
        <CardDescription className="text-[13px] leading-6 text-foreground">
          Proposed: <span className="font-medium">{verdict.proposedAction}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm leading-relaxed">{verdict.rationale}</p>

        <div className="space-y-1.5">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Grounded in your record
          </div>
          {verdict.conflictingFacts.map((f, i) => (
            <blockquote key={i} className="border-l-2 border-foreground/20 bg-muted/30 px-2 py-1.5 text-[12px]">
              <span className="block font-medium">{f.display}</span>
              <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">{f.sourceLabel}</span>
              <span className="mt-0.5 block font-mono text-foreground/90">&ldquo;{f.textSpan}&rdquo;</span>
            </blockquote>
          ))}
        </div>

        {verdict.unseenBy && (
          <div className="border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-amber-300">
              Why no one in the room could catch this
            </div>
            <p className="mt-1 text-[13px] leading-6">{verdict.unseenBy}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
              <span>
                Concord reconciled <span className="font-medium text-foreground">{record.medications.length}</span> meds
                across <span className="font-medium text-foreground">{sourceCount}</span>{" "}
                {sourceCount === 1 ? "source" : "sources"}
              </span>
              <span aria-hidden>·</span>
              <span>
                Conflict spans{" "}
                <span className="font-medium text-foreground">{[...involved].join(" + ") || "multiple sources"}</span>
              </span>
            </div>
          </div>
        )}

        {verdict.safeAlternative && (
          <div className="flex items-start gap-2 border border-emerald-500/30 bg-emerald-500/5 p-3">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-300" />
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-emerald-300">Safer alternative</div>
              <p className="mt-0.5 text-[13px] leading-6">{verdict.safeAlternative}</p>
            </div>
          </div>
        )}

        {verdict.citationUrl && (
          <a
            href={verdict.citationUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-[11px] text-foreground underline-offset-2 hover:underline"
          >
            {verdict.citationLabel ?? "Source"} ↗
          </a>
        )}
      </CardContent>
    </Card>
  );
}

function Transcript({
  committed,
  liveRoom,
  liveGuardian,
  active,
}: {
  committed: TranscriptTurn[];
  liveRoom: string;
  liveGuardian: string;
  active: boolean;
}) {
  if (committed.length === 0 && !liveRoom && !liveGuardian) {
    return (
      <p className="text-sm text-muted-foreground">
        {active ? "Listening… speak as the clinician would in the room." : "Start listening to capture the visit."}
      </p>
    );
  }
  return (
    <div className="space-y-2.5 text-sm">
      {committed.map((t, i) => (
        <TranscriptLine key={i} role={t.role} text={t.text} />
      ))}
      {liveRoom && <TranscriptLine role="room" text={liveRoom} dim />}
      {liveGuardian && <TranscriptLine role="guardian" text={liveGuardian} dim />}
    </div>
  );
}

function SourceToggle({
  value,
  onChange,
  disabled,
}: {
  value: CaptureSource;
  onChange: (v: CaptureSource) => void;
  disabled?: boolean;
}) {
  const options: { id: CaptureSource; label: string }[] = [
    { id: "mic", label: "Microphone" },
    { id: "tab", label: "Tab audio" },
  ];
  return (
    <div className="inline-flex rounded-md border border-border/60 p-0.5" role="group" aria-label="Listen via">
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt.id)}
          className={`rounded-[5px] px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
            value === opt.id ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function TranscriptLine({ role, text, dim }: { role: "room" | "guardian"; text: string; dim?: boolean }) {
  const isGuardian = role === "guardian";
  return (
    <div className={`flex gap-2 ${dim ? "opacity-60" : ""}`}>
      <span
        className={`mt-0.5 shrink-0 text-[10px] font-medium uppercase tracking-wide ${
          isGuardian ? "text-emerald-300" : "text-muted-foreground"
        }`}
      >
        {isGuardian ? "Concord" : "Room"}
      </span>
      <span className={isGuardian ? "font-medium" : ""}>{text}</span>
    </div>
  );
}

function HoldingPanel({ record }: { record: HealthRecord }) {
  const trends = record.labs.filter((l) => l.trend && l.trend !== "stable");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">What the Guardian is holding</CardTitle>
        <CardDescription className="text-[13px]">
          The reconciled record the clinician in the room may not have.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <Stat label="Active medications" value={record.medications.length} />
        <Stat label="Allergies" value={record.allergies.length} />
        <Stat label="Conditions" value={record.conditions.length} />
        <Stat label="Source documents" value={record.sources.length} />
        {trends.length > 0 && (
          <div className="border-t border-border pt-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Watching trends</div>
            <ul className="mt-1 space-y-0.5 text-[13px]">
              {trends.map((l) => (
                <li key={l.id}>
                  {l.display} — <span className="text-amber-300">{l.trend}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium">{value}</span>
    </div>
  );
}

function AssessmentLog({ events }: { events: AssessmentEvent[] }) {
  if (events.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Assessed this visit</CardTitle>
        <CardDescription className="text-[13px]">Every clinical decision the Guardian checked.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {events.map((e) => (
          <div key={e.id} className="flex items-start gap-2 text-[13px]">
            {e.status === "flagged" ? (
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-red-300" />
            ) : (
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-300" />
            )}
            <div className="min-w-0">
              <span className="font-medium">{e.action}</span>
              <span className="text-muted-foreground">
                {e.status === "flagged" ? " — flagged" : " — no conflict"}
              </span>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
