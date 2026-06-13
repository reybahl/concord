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
  Trash2,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { toFhirBundle } from "@/lib/fhir";
import type {
  HealthRecord,
  Insight,
  MedicationFact,
  NoteEvent,
  PipelineEvent,
  Severity,
  StageEvent,
} from "@/lib/types";

type Status = "idle" | "running" | "done";

interface UploadedDocument {
  id: string;
  filename: string;
  label: string;
  system: string | null;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

interface SavedRecordMeta {
  id: string;
  title: string;
  record: HealthRecord;
  sourceDocumentIds: string[];
  reconciledAt: string;
}

interface LiveNote {
  text: string;
  tone?: "info" | "merge" | "flag" | "model";
}

interface LiveStage {
  stage: string;
  label: string;
  status: "start" | "done";
  detail?: string;
  notes: LiveNote[];
}

const SEVERITY: Record<Severity, { ring: string; text: string; bg: string; label: string }> = {
  high: { ring: "border-red-500/50", text: "text-red-300", bg: "bg-red-500/10", label: "High" },
  medium: { ring: "border-amber-500/40", text: "text-amber-300", bg: "bg-amber-500/10", label: "Medium" },
  low: { ring: "border-sky-500/40", text: "text-sky-300", bg: "bg-sky-500/10", label: "Low" },
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function documentSetsMatch(savedIds: string[], currentIds: string[]): boolean {
  if (savedIds.length !== currentIds.length) return false;
  const a = [...savedIds].sort();
  const b = [...currentIds].sort();
  return a.every((id, i) => id === b[i]);
}

function describeStaleChange(savedIds: string[], currentIds: string[]): string {
  const saved = new Set(savedIds);
  const current = new Set(currentIds);
  const added = currentIds.filter((id) => !saved.has(id)).length;
  const removed = savedIds.filter((id) => !current.has(id)).length;
  if (added && removed) {
    return `${added} new and ${removed} removed — your saved record may be outdated. Reconcile to update.`;
  }
  if (added) {
    return `${added} new document${added === 1 ? "" : "s"} since last reconcile — run again to update your record.`;
  }
  if (removed) {
    return `${removed} document${removed === 1 ? "" : "s"} removed — run again to update your record.`;
  }
  return "Uploads changed — run again to update your saved record.";
}

export function ConcordApp() {
  const [status, setStatus] = useState<Status>("idle");
  const [stages, setStages] = useState<LiveStage[]>([]);
  const [record, setRecord] = useState<HealthRecord | null>(null);
  const [savedSourceDocumentIds, setSavedSourceDocumentIds] = useState<string[]>([]);
  const [reconciledAt, setReconciledAt] = useState<string | null>(null);
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshSavedRecord = useCallback(async () => {
    const res = await fetch("/api/record");
    const data = (await res.json()) as {
      configured?: boolean;
      saved?: SavedRecordMeta | null;
    };

    if (!res.ok || !data.saved) return;

    setRecord(data.saved.record);
    setSavedSourceDocumentIds(data.saved.sourceDocumentIds);
    setReconciledAt(data.saved.reconciledAt);
    setStatus("done");
  }, []);

  const refreshDocuments = useCallback(async () => {
    setLoadingDocs(true);
    const res = await fetch("/api/documents");
    const data = (await res.json()) as {
      configured?: boolean;
      documents?: UploadedDocument[];
      error?: string;
    };

    if (data.configured === false) {
      setStorageError(data.error ?? "Storage is not configured.");
      setDocuments([]);
      setLoadingDocs(false);
      return;
    }

    if (!res.ok) {
      setStorageError(data.error ?? "Storage is not configured.");
      setDocuments([]);
      setLoadingDocs(false);
      return;
    }

    setStorageError(null);
    setDocuments(data.documents ?? []);
    setLoadingDocs(false);
  }, []);

  useEffect(() => {
    // Standard fetch-on-mount: load uploads and any saved reconciliation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void Promise.all([refreshDocuments(), refreshSavedRecord()]);
  }, [refreshDocuments, refreshSavedRecord]);

  async function uploadFiles(files: FileList | File[]) {
    if (storageError) return;
    setUploading(true);
    setActionError(null);

    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/documents", { method: "POST", body: form });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Upload failed.");
      }
      await refreshDocuments();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function removeDocument(id: string) {
    setActionError(null);
    const res = await fetch(`/api/documents/${id}`, { method: "DELETE" });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setActionError(data.error ?? "Delete failed.");
      return;
    }
    await refreshDocuments();
  }

  async function run() {
    if (documents.length === 0) return;
    setStatus("running");
    setStages([]);
    setRecord(null);
    setActionError(null);

    const res = await fetch("/api/reconcile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setActionError(data.error ?? "Reconciliation failed.");
      setStatus("idle");
      return;
    }
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
        if (event.type === "error") {
          setActionError(event.message);
          setStatus("idle");
          return;
        }
        if (event.type === "stage") applyStage(event);
        else if (event.type === "note") applyNote(event);
        else if (event.type === "result") setRecord(event.record);
      }
    }
    setStatus("done");
    setSavedSourceDocumentIds(documents.map((d) => d.id));
    setReconciledAt(new Date().toISOString());
  }

  const currentDocumentIds = documents.map((d) => d.id);
  const recordStale =
    record !== null &&
    savedSourceDocumentIds.length > 0 &&
    !documentSetsMatch(savedSourceDocumentIds, currentDocumentIds);
  const staleMessage = recordStale
    ? describeStaleChange(savedSourceDocumentIds, currentDocumentIds)
    : null;

  function applyStage(event: StageEvent) {
    setStages((prev) => {
      const existing = prev.find((s) => s.stage === event.stage);
      if (existing) {
        return prev.map((s) =>
          s.stage === event.stage ? { ...s, status: event.status, detail: event.detail ?? s.detail } : s,
        );
      }
      return [
        ...prev,
        { stage: event.stage, label: event.label, status: event.status, detail: event.detail, notes: [] },
      ];
    });
  }

  function applyNote(event: NoteEvent) {
    setStages((prev) => {
      const existing = prev.find((s) => s.stage === event.stage);
      const note: LiveNote = { text: event.text, tone: event.tone };
      if (existing) {
        return prev.map((s) =>
          s.stage === event.stage ? { ...s, notes: [...s.notes, note] } : s,
        );
      }
      return [...prev, { stage: event.stage, label: event.stage, status: "start", notes: [note] }];
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

  const canReconcile = documents.length > 0 && !storageError && !uploading && status !== "running";

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-10">
      <Header status={status} hasRecord={Boolean(record)} stale={recordStale} />

      {storageError && (
        <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          {storageError} Set <code className="text-amber-50">DATABASE_URL</code> and{" "}
          <code className="text-amber-50">BLOB_READ_WRITE_TOKEN</code>, then run{" "}
          <code className="text-amber-50">pnpm db:push</code>.
        </div>
      )}

      {actionError && (
        <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {actionError}
        </div>
      )}

      <Hero
        status={status}
        onRun={run}
        canReconcile={canReconcile}
        documentCount={documents.length}
        stale={recordStale}
        hasRecord={Boolean(record)}
      />

      {recordStale && staleMessage && (
        <StaleBanner message={staleMessage} onReconcile={run} canReconcile={canReconcile} />
      )}

      <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <UploadPanel
          documents={documents}
          loading={loadingDocs}
          uploading={uploading}
          disabled={Boolean(storageError)}
          fileInputRef={fileInputRef}
          onPickFiles={() => fileInputRef.current?.click()}
          onFilesSelected={(files) => void uploadFiles(files)}
          onRemove={(id) => void removeDocument(id)}
        />
        <main className="min-w-0 space-y-6">
          {status === "running" && <Pipeline stages={stages} />}
          {record && status !== "running" && (
            <Results
              record={record}
              stale={recordStale}
              reconciledAt={reconciledAt}
              onExport={downloadFhir}
            />
          )}
          {status === "idle" && !record && (
            <IdleHint documentCount={documents.length} hasStorage={!storageError} />
          )}
        </main>
      </div>

      <footer className="mt-16 border-t border-white/5 pt-6 text-center text-xs text-slate-500">
        Concord · uploads in Vercel Blob · reconciliation persisted in Postgres · grounded
      </footer>
    </div>
  );
}

function Header({
  status,
  hasRecord,
  stale,
}: {
  status: Status;
  hasRecord: boolean;
  stale: boolean;
}) {
  const badge =
    status === "running"
      ? { label: "Reconciling…", className: "border-sky-500/40 bg-sky-500/10 text-sky-300" }
      : stale
        ? { label: "Outdated", className: "border-amber-500/40 bg-amber-500/10 text-amber-300" }
        : hasRecord
          ? { label: "Reconciled", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" }
          : { label: "Ready", className: "border-white/10 bg-white/5 text-slate-400" };

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
      <span className={`rounded-full border px-3 py-1 text-xs ${badge.className}`}>{badge.label}</span>
    </header>
  );
}

function StaleBanner({
  message,
  onReconcile,
  canReconcile,
}: {
  message: string;
  onReconcile: () => void;
  canReconcile: boolean;
}) {
  return (
    <div className="mt-6 flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 text-sm text-amber-100">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-300" />
        <span>{message}</span>
      </div>
      <button
        onClick={onReconcile}
        disabled={!canReconcile}
        className="shrink-0 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-xs font-medium text-amber-100 transition hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Update reconciliation
      </button>
    </div>
  );
}

function Hero({
  status,
  onRun,
  canReconcile,
  documentCount,
  stale,
  hasRecord,
}: {
  status: Status;
  onRun: () => void;
  canReconcile: boolean;
  documentCount: number;
  stale: boolean;
  hasRecord: boolean;
}) {
  const buttonLabel =
    status === "running"
      ? "Reconciling…"
      : documentCount === 0
        ? "Upload records to reconcile"
        : stale
          ? "Update reconciliation"
          : hasRecord
            ? "Run again"
            : `Reconcile ${documentCount} record${documentCount === 1 ? "" : "s"}`;

  return (
    <section className="mt-10 max-w-3xl">
      <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
        <Sparkles className="size-3.5 text-sky-300" /> Powered by Grok · FHIR-native · grounded
      </div>
      <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
        Upload your records.{" "}
        <span className="bg-gradient-to-r from-sky-300 to-indigo-300 bg-clip-text text-transparent">
          Catch what falls through the cracks.
        </span>
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-slate-300">
        Drop in visit summaries, lab reports, and pharmacy printouts from different providers. Concord
        assembles one grounded picture — and flags dangerous oversights no single doctor could see.
      </p>
      <button
        onClick={onRun}
        disabled={status === "running" || !canReconcile}
        className="mt-7 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-400 to-indigo-500 px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-sky-500/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status === "running" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Activity className="size-4" />
        )}
        {buttonLabel}
      </button>
    </section>
  );
}

function UploadPanel({
  documents,
  loading,
  uploading,
  disabled,
  fileInputRef,
  onPickFiles,
  onFilesSelected,
  onRemove,
}: {
  documents: UploadedDocument[];
  loading: boolean;
  uploading: boolean;
  disabled: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onPickFiles: () => void;
  onFilesSelected: (files: FileList) => void;
  onRemove: (id: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <aside className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-medium text-slate-300">
        <Layers className="size-4 text-slate-400" /> Your uploads ({documents.length})
      </h2>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (disabled || !e.dataTransfer.files.length) return;
          onFilesSelected(e.dataTransfer.files);
        }}
        className={`rounded-xl border border-dashed p-4 text-center transition ${
          dragOver
            ? "border-sky-400/60 bg-sky-500/10"
            : "border-white/15 bg-white/[0.02] hover:border-white/25"
        } ${disabled ? "opacity-50" : ""}`}
      >
        <Upload className="mx-auto size-6 text-slate-500" />
        <p className="mt-2 text-sm text-slate-300">Drop .txt medical records here</p>
        <p className="mt-1 text-xs text-slate-500">or</p>
        <button
          type="button"
          onClick={onPickFiles}
          disabled={disabled || uploading}
          className="mt-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-white/10 disabled:opacity-50"
        >
          {uploading ? "Uploading…" : "Choose files"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,text/plain,text/markdown"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) onFilesSelected(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="size-3.5 animate-spin" /> Loading uploads…
        </div>
      ) : documents.length === 0 ? (
        <p className="px-1 text-xs leading-relaxed text-slate-500">
          For the demo, upload the five synthetic records from the repo&apos;s{" "}
          <code className="text-slate-400">demo-data/</code> folder.
        </p>
      ) : (
        documents.map((doc) => (
          <div key={doc.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-start gap-2">
              <FileText className="mt-0.5 size-4 shrink-0 text-slate-500" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{doc.label}</div>
                <div className="truncate text-xs text-slate-400">{doc.filename}</div>
                <div className="mt-0.5 text-xs text-slate-500">{formatBytes(doc.sizeBytes)}</div>
              </div>
              <button
                type="button"
                onClick={() => onRemove(doc.id)}
                disabled={disabled || uploading}
                className="rounded-md p-1 text-slate-500 transition hover:bg-white/5 hover:text-red-300 disabled:opacity-40"
                aria-label={`Remove ${doc.filename}`}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </div>
        ))
      )}
    </aside>
  );
}

function IdleHint({
  documentCount,
  hasStorage,
}: {
  documentCount: number;
  hasStorage: boolean;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-center">
      <Stethoscope className="mx-auto size-8 text-slate-600" />
      <p className="mx-auto mt-3 max-w-sm text-sm text-slate-400">
        {documentCount === 0
          ? hasStorage
            ? "Upload your medical records on the left, then press Reconcile."
            : "Configure Postgres + Vercel Blob to enable uploads."
          : "Press Reconcile to watch Concord read your uploads, normalize them to standard codes, ground every fact to its source, and run a cross-provider safety check."}
      </p>
    </div>
  );
}

const NOTE_TONE: Record<NonNullable<LiveNote["tone"]>, string> = {
  info: "text-slate-400 border-white/10",
  model: "text-sky-300 border-sky-500/30",
  merge: "text-emerald-300 border-emerald-500/30",
  flag: "text-amber-300 border-amber-500/40",
};

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
            <div className="min-w-0 flex-1">
              <div className={`text-sm ${s.status === "done" ? "text-slate-200" : "text-slate-100"}`}>
                {s.label}
              </div>
              {s.detail && <div className="text-xs text-slate-400">{s.detail}</div>}
              {s.notes.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {s.notes.map((n, i) => (
                    <li
                      key={i}
                      className={`border-l-2 pl-2 text-xs leading-relaxed ${NOTE_TONE[n.tone ?? "info"]}`}
                    >
                      {n.text}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Results({
  record,
  stale,
  reconciledAt,
  onExport,
}: {
  record: HealthRecord;
  stale: boolean;
  reconciledAt: string | null;
  onExport: () => void;
}) {
  const sorted = [...record.insights].sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 };
    return rank[a.severity] - rank[b.severity];
  });

  const savedLabel = reconciledAt
    ? `Saved ${new Date(reconciledAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })}`
    : null;

  return (
    <div className={`space-y-6 ${stale ? "opacity-80" : ""}`}>
      {(savedLabel || stale) && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          {savedLabel && <span>{savedLabel}</span>}
          {stale && (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-200">
              May be outdated
            </span>
          )}
        </div>
      )}
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
