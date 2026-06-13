"use client";

import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Download,
  FileText,
  FlaskConical,
  Layers,
  Loader2,
  Pill,
  ShieldAlert,
  Sparkles,
  Stethoscope,
} from "lucide-react";
import { useState } from "react";

import { DEMO_DOCS } from "@/lib/demo-documents";
import { toFhirBundle } from "@/lib/fhir";
import type {
  HealthRecord,
  Insight,
  MedicationFact,
  PipelineEvent,
  Severity,
  StageEvent,
} from "@/lib/types";

type Status = "idle" | "running" | "done";

interface LiveStage {
  stage: string;
  label: string;
  status: "start" | "done";
  detail?: string;
}

const SEVERITY: Record<Severity, { ring: string; text: string; bg: string; label: string }> = {
  high: { ring: "border-red-500/50", text: "text-red-300", bg: "bg-red-500/10", label: "High" },
  medium: { ring: "border-amber-500/40", text: "text-amber-300", bg: "bg-amber-500/10", label: "Medium" },
  low: { ring: "border-sky-500/40", text: "text-sky-300", bg: "bg-sky-500/10", label: "Low" },
};

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [stages, setStages] = useState<LiveStage[]>([]);
  const [record, setRecord] = useState<HealthRecord | null>(null);

  async function run() {
    setStatus("running");
    setStages([]);
    setRecord(null);

    const res = await fetch("/api/reconcile", { method: "POST" });
    if (!res.body) return;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as PipelineEvent;
        if (event.type === "stage") applyStage(event);
        else if (event.type === "result") setRecord(event.record);
      }
    }
    setStatus("done");
  }

  function applyStage(event: StageEvent) {
    setStages((prev) => {
      const existing = prev.find((s) => s.stage === event.stage);
      if (existing) {
        return prev.map((s) =>
          s.stage === event.stage ? { ...s, status: event.status, detail: event.detail ?? s.detail } : s,
        );
      }
      return [...prev, { stage: event.stage, label: event.label, status: event.status, detail: event.detail }];
    });
  }

  function downloadFhir() {
    if (!record) return;
    const blob = new Blob([JSON.stringify(toFhirBundle(record), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "concord-health-record.fhir.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-10">
      <Header status={status} />

      <Hero status={status} onRun={run} />

      <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <SourcesPanel />
        <main className="min-w-0 space-y-6">
          {status !== "idle" && <Pipeline stages={stages} />}
          {record && <Results record={record} onExport={downloadFhir} />}
          {status === "idle" && <IdleHint />}
        </main>
      </div>

      <footer className="mt-16 border-t border-white/5 pt-6 text-center text-xs text-slate-500">
        Concord · synthetic demo data · grounded reconciliation with citations to source documents
      </footer>
    </div>
  );
}

function Header({ status }: { status: Status }) {
  return (
    <header className="flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <div className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-sky-400 to-indigo-500 text-base font-bold text-slate-950">
          ◇
        </div>
        <div>
          <div className="text-lg font-semibold leading-none">Concord</div>
          <div className="text-xs text-slate-400">Patient-owned health reconciliation</div>
        </div>
      </div>
      <span
        className={`rounded-full border px-3 py-1 text-xs ${
          status === "done"
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
            : status === "running"
              ? "border-sky-500/40 bg-sky-500/10 text-sky-300"
              : "border-white/10 bg-white/5 text-slate-400"
        }`}
      >
        {status === "done" ? "Reconciled" : status === "running" ? "Reconciling…" : "Ready"}
      </span>
    </header>
  );
}

function Hero({ status, onRun }: { status: Status; onRun: () => void }) {
  return (
    <section className="mt-10 max-w-3xl">
      <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
        <Sparkles className="size-3.5 text-sky-300" /> Powered by Grok · FHIR-native · grounded
      </div>
      <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
        The complete picture of your health that{" "}
        <span className="bg-gradient-to-r from-sky-300 to-indigo-300 bg-clip-text text-transparent">
          nobody currently has.
        </span>
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-slate-300">
        Maria sees five providers who don&apos;t share one record. Concord assembles them into a
        single grounded timeline — and catches the contraindicated prescription that falls through
        the cracks between them.
      </p>
      <button
        onClick={onRun}
        disabled={status === "running"}
        className="mt-7 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-400 to-indigo-500 px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-sky-500/20 transition hover:brightness-110 disabled:opacity-60"
      >
        {status === "running" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Activity className="size-4" />
        )}
        {status === "idle" ? "Reconcile Maria's records" : status === "running" ? "Reconciling…" : "Run again"}
      </button>
    </section>
  );
}

function SourcesPanel() {
  return (
    <aside className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-medium text-slate-300">
        <Layers className="size-4 text-slate-400" /> Source documents ({DEMO_DOCS.length})
      </h2>
      {DEMO_DOCS.map((doc) => (
        <div key={doc.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="flex items-start gap-2">
            <FileText className="mt-0.5 size-4 shrink-0 text-slate-500" />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{doc.label}</div>
              <div className="truncate text-xs text-slate-400">{doc.system}</div>
              <div className="mt-0.5 text-xs text-slate-500">{doc.date}</div>
            </div>
          </div>
        </div>
      ))}
      <p className="px-1 text-xs leading-relaxed text-slate-500">
        Five systems, five different patient IDs, brand vs generic names, a dropped allergy, and a
        unit mismatch — the real-world mess Concord untangles.
      </p>
    </aside>
  );
}

function IdleHint() {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-center">
      <Stethoscope className="mx-auto size-8 text-slate-600" />
      <p className="mx-auto mt-3 max-w-sm text-sm text-slate-400">
        Press <span className="font-medium text-slate-200">Reconcile</span> to watch Concord read all
        five records, normalize them to standard codes, ground every fact to its source, and run a
        cross-provider safety check.
      </p>
    </div>
  );
}

function Pipeline({ stages }: { stages: LiveStage[] }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <h2 className="mb-4 text-sm font-medium text-slate-300">Reconciliation pipeline</h2>
      <ol className="space-y-3">
        {stages.map((s) => (
          <li key={s.stage} className="flex items-start gap-3">
            <span className="mt-0.5">
              {s.status === "done" ? (
                <CheckCircle2 className="size-5 text-emerald-400" />
              ) : (
                <Loader2 className="size-5 animate-spin text-sky-400" />
              )}
            </span>
            <div>
              <div className={`text-sm ${s.status === "done" ? "text-slate-200" : "text-slate-100"}`}>
                {s.label}
              </div>
              {s.detail && <div className="text-xs text-slate-400">{s.detail}</div>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Results({ record, onExport }: { record: HealthRecord; onExport: () => void }) {
  const sorted = [...record.insights].sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 };
    return rank[a.severity] - rank[b.severity];
  });

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-medium text-slate-300">
            <ShieldAlert className="size-4 text-red-400" /> Findings ({record.insights.length})
          </h2>
          <button
            onClick={onExport}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-white/10"
          >
            <Download className="size-3.5" /> Export FHIR
          </button>
        </div>
        <div className="space-y-3">
          {sorted.map((i) => (
            <InsightCard key={i.id} insight={i} />
          ))}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Card title="Medications" icon={<Pill className="size-4 text-sky-300" />}>
          <div className="space-y-2.5">
            {record.medications.map((m) => (
              <MedRow key={m.id} med={m} />
            ))}
          </div>
        </Card>

        <Card title="Labs & trends" icon={<FlaskConical className="size-4 text-sky-300" />}>
          <div className="space-y-3">
            {record.labs.map((lab) => (
              <div key={lab.id}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-200">{lab.display}</span>
                  <TrendBadge trend={lab.trend} />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {lab.series.map((p, idx) => (
                    <span
                      key={idx}
                      className="rounded-md bg-white/5 px-1.5 py-0.5 font-mono text-xs text-slate-300"
                      title={p.reported ? `reported: ${p.reported}` : undefined}
                    >
                      {p.value ?? p.reported} {p.value != null ? p.unit : ""}
                      {p.reported && p.normalizedValue ? " ⚐" : ""}
                    </span>
                  ))}
                </div>
                {lab.loinc && <CodeChip system="LOINC" code={lab.loinc} />}
              </div>
            ))}
          </div>
        </Card>

        <Card title="Conditions" icon={<Activity className="size-4 text-sky-300" />}>
          <div className="space-y-2">
            {record.conditions.map((c) => (
              <div key={c.id} className="text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-slate-200">{c.display}</span>
                  {c.inferred && (
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                      inferred
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex gap-1.5">
                  {c.icd10 && <CodeChip system="ICD-10" code={c.icd10} />}
                  {c.snomed && <CodeChip system="SNOMED" code={c.snomed} />}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Allergies" icon={<AlertTriangle className="size-4 text-sky-300" />}>
          {record.allergies.map((a) => (
            <div key={a.id} className="text-sm">
              <span className="text-slate-200">{a.display}</span>
              {a.reaction && <span className="text-slate-400"> · {a.reaction}</span>}
              <div className="mt-1">
                {a.snomed && <CodeChip system="SNOMED" code={a.snomed} />}
              </div>
              <p className="mt-1.5 text-xs text-amber-300/80">
                Carried into the reconciled record even though cardiology &amp; pharmacy dropped it.
              </p>
            </div>
          ))}
        </Card>
      </section>
    </div>
  );
}

function InsightCard({ insight }: { insight: Insight }) {
  const s = SEVERITY[insight.severity];
  return (
    <div className={`rounded-xl border ${s.ring} ${s.bg} p-4`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          {insight.severity === "high" ? (
            <ShieldAlert className={`size-4 ${s.text}`} />
          ) : (
            <AlertTriangle className={`size-4 ${s.text}`} />
          )}
          <h3 className="text-sm font-semibold text-slate-100">{insight.title}</h3>
        </div>
        <span className={`shrink-0 rounded-full border ${s.ring} px-2 py-0.5 text-[10px] font-medium ${s.text}`}>
          {s.label}
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-slate-300">{insight.explanation}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {insight.crossProvider && (
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-slate-300">
            cross-provider
          </span>
        )}
        {insight.citationUrl && (
          <a
            href={insight.citationUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-sky-300 underline-offset-2 hover:underline"
          >
            {insight.citationLabel ?? "source"} ↗
          </a>
        )}
      </div>
    </div>
  );
}

function MedRow({ med }: { med: MedicationFact }) {
  return (
    <div className="rounded-lg bg-white/[0.03] p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-200">{med.display}</span>
        {med.status === "acute" && (
          <span className="rounded bg-purple-500/15 px-1.5 py-0.5 text-[10px] text-purple-300">acute</span>
        )}
      </div>
      {med.sig && <div className="text-xs text-slate-400">{med.sig}</div>}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {med.rxnorm && <CodeChip system="RxNorm" code={med.rxnorm} />}
        {med.aliases && med.aliases.length > 1 && (
          <span className="text-[10px] text-slate-500">merged from {med.aliases.length} names</span>
        )}
        {med.reviewNeeded && (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
            duplicate risk
          </span>
        )}
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {med.provenance.map((p, idx) => (
          <span key={idx} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
            {p.sourceLabel}
          </span>
        ))}
      </div>
    </div>
  );
}

function TrendBadge({ trend }: { trend?: string }) {
  if (!trend || trend === "stable") return null;
  const rising = trend === "rising";
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs ${rising ? "text-red-300" : "text-amber-300"}`}>
      {rising ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
      {trend}
    </span>
  );
}

function CodeChip({ system, code }: { system: string; code: string }) {
  return (
    <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
      {system} {code}
    </span>
  );
}

function Card({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-300">
        {icon} {title}
      </h3>
      {children}
    </div>
  );
}
