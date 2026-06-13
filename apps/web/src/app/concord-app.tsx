"use client";

import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Download,
  ExternalLink,
  FileText,
  FlaskConical,
  Layers,
  Loader2,
  Pill,
  ShieldAlert,
  Stethoscope,
  Trash2,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { AppSidebar, type DashboardView } from "@/components/app-sidebar";
import { GuardianView } from "@/components/guardian-view";
import { ProvenanceChips } from "@/components/provenance-chips";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { PipelinePanel } from "@/components/pipeline-panel";
import { WorkflowOverview } from "@/components/workflow-overview";
import { foldPipelineEvents, type PipelineStageSnapshot } from "@/lib/pipeline-log";
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
  pipelineLog: {
    events: Array<StageEvent | NoteEvent>;
    completedAt: string;
  } | null;
}

interface LiveNote {
  text: string;
  tone?: "info" | "merge" | "flag" | "model";
  slot?: string;
}

type LiveStage = PipelineStageSnapshot;

const SEVERITY: Record<Severity, { ring: string; text: string; bg: string; label: string }> = {
  high: { ring: "border-red-500/50", text: "text-red-300", bg: "bg-red-500/10", label: "High" },
  medium: { ring: "border-amber-500/40", text: "text-amber-300", bg: "bg-amber-500/10", label: "Medium" },
  low: { ring: "border-border", text: "text-muted-foreground", bg: "bg-muted/30", label: "Low" },
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
  const [activeView, setActiveView] = useState<DashboardView>("overview");
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
    setStages(
      data.saved.pipelineLog ? foldPipelineEvents(data.saved.pipelineLog.events) : [],
    );
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
    setActiveView("upload");
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
      const note: LiveNote = { text: event.text, tone: event.tone, slot: event.slot };
      const existing = prev.find((s) => s.stage === event.stage);
      if (existing) {
        return prev.map((s) => {
          if (s.stage !== event.stage) return s;
          if (event.slot) {
            const slotIndex = s.notes.findIndex((n) => n.slot === event.slot);
            if (slotIndex >= 0) {
              const notes = [...s.notes];
              notes[slotIndex] = note;
              return { ...s, notes };
            }
          }
          return { ...s, notes: [...s.notes, note] };
        });
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

  const statusLabel =
    status === "running"
      ? "Reconciling…"
      : recordStale
        ? "Outdated"
        : record
          ? "Reconciled"
          : "Ready";

  const highFindingCount =
    record?.insights.filter((i) => i.severity === "high").length ?? 0;

  const pageTitles: Record<DashboardView, { title: string; description: string }> = {
    overview: {
      title: "Overview",
      description: "Your reconciled health picture at a glance.",
    },
    upload: {
      title: "Upload & reconcile",
      description: "Add medical records and run Grok reconciliation.",
    },
    findings: {
      title: "Findings",
      description: "Cross-provider safety insights and verified sources.",
    },
    record: {
      title: "Health record",
      description: "Medications, labs, conditions, and allergies — coded and grounded.",
    },
    guardian: {
      title: "Guardian",
      description: "Live point-of-care safety — your record speaks up when a decision is unsafe.",
    },
  };

  const { title: pageTitle, description: pageDescription } = pageTitles[activeView];

  return (
    <SidebarProvider>
      <AppSidebar
        activeView={activeView}
        onNavigate={setActiveView}
        documentCount={documents.length}
        highFindingCount={highFindingCount}
        statusLabel={statusLabel}
      />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
          <SidebarTrigger className="shrink-0" />
          <Separator orientation="vertical" className="h-4 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 leading-none">
            <h1 className="truncate text-sm font-medium leading-tight">{pageTitle}</h1>
            <p className="truncate text-xs text-muted-foreground leading-tight">{pageDescription}</p>
          </div>
          <StatusBadge status={status} hasRecord={Boolean(record)} stale={recordStale} />
        </header>

        <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
          {storageError && (
            <Alert variant="destructive">
              <AlertTitle>Storage not configured</AlertTitle>
              <AlertDescription>
                {storageError} Set <code>DATABASE_URL</code> and <code>BLOB_READ_WRITE_TOKEN</code>,
                then run <code>pnpm db:push</code>.
              </AlertDescription>
            </Alert>
          )}

          {actionError && (
            <Alert variant="destructive">
              <AlertTitle>Something went wrong</AlertTitle>
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          )}

          {recordStale && staleMessage && activeView !== "upload" && (
            <StaleBanner message={staleMessage} onReconcile={run} canReconcile={canReconcile} />
          )}

          {activeView === "overview" && (
            <OverviewView
              record={record}
              documents={documents}
              status={status}
              stages={stages}
              stale={recordStale}
              reconciledAt={reconciledAt}
              canReconcile={canReconcile}
              onRun={run}
              onNavigate={setActiveView}
            />
          )}

          {activeView === "upload" && (
            <UploadView
              documents={documents}
              loadingDocs={loadingDocs}
              uploading={uploading}
              storageError={storageError}
              status={status}
              stages={stages}
              reconciledAt={reconciledAt}
              record={record}
              stale={recordStale}
              staleMessage={staleMessage}
              canReconcile={canReconcile}
              fileInputRef={fileInputRef}
              onRun={run}
              onPickFiles={() => fileInputRef.current?.click()}
              onFilesSelected={(files) => void uploadFiles(files)}
              onRemove={(id) => void removeDocument(id)}
            />
          )}

          {activeView === "findings" && (
            <FindingsView
              record={record}
              stale={recordStale}
              reconciledAt={reconciledAt}
              onExport={downloadFhir}
              onNavigate={setActiveView}
            />
          )}

          {activeView === "record" && (
            <RecordView record={record} stale={recordStale} onExport={downloadFhir} />
          )}

          {activeView === "guardian" && (
            <GuardianView
              record={record}
              onLearned={() => void refreshDocuments()}
              onGoToUpload={() => setActiveView("upload")}
            />
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function StatusBadge({
  status,
  hasRecord,
  stale,
}: {
  status: Status;
  hasRecord: boolean;
  stale: boolean;
}) {
  if (status === "running") {
    return (
      <Badge variant="secondary" className="gap-1">
        <Loader2 className="size-3 animate-spin" /> Reconciling
      </Badge>
    );
  }
  if (stale) {
    return <Badge variant="outline" className="border-amber-500/40 text-amber-300">Outdated</Badge>;
  }
  if (hasRecord) {
    return <Badge variant="outline">Reconciled</Badge>;
  }
  return <Badge variant="secondary">Ready</Badge>;
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
    <Alert className="border-amber-500/40 text-amber-300">
      <AlertTriangle className="text-amber-300" />
      <AlertTitle>Record may be outdated</AlertTitle>
      <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span>{message}</span>
        <Button
          size="sm"
          variant="outline"
          onClick={onReconcile}
          disabled={!canReconcile}
          className="shrink-0 border-amber-500/40 text-amber-300"
        >
          Update reconciliation
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function OverviewView({
  record,
  documents,
  status,
  stages,
  stale,
  reconciledAt,
  canReconcile,
  onRun,
  onNavigate,
}: {
  record: HealthRecord | null;
  documents: UploadedDocument[];
  status: Status;
  stages: LiveStage[];
  stale: boolean;
  reconciledAt: string | null;
  canReconcile: boolean;
  onRun: () => void;
  onNavigate: (view: DashboardView) => void;
}) {
  const highCount = record?.insights.filter((i) => i.severity === "high").length ?? 0;
  const topFindings = record
    ? [...record.insights]
        .sort((a, b) => {
          const rank = { high: 0, medium: 1, low: 2 };
          return rank[a.severity] - rank[b.severity];
        })
        .slice(0, 3)
    : [];

  const reconciledLabel = reconciledAt
    ? new Date(reconciledAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-medium tracking-tight">
            {record?.patient.name ?? "Your health record"}
          </CardTitle>
          <CardDescription className="max-w-2xl text-[13px] leading-6">
            Upload records from every provider. Concord assembles one grounded picture and flags
            dangerous oversights no single doctor could see.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button onClick={onRun} disabled={status === "running" || !canReconcile}>
            {status === "running" ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Activity />
            )}
            {status === "running"
              ? "Reconciling…"
              : documents.length === 0
                ? "Upload records first"
                : stale
                  ? "Update reconciliation"
                  : record
                    ? "Run again"
                    : `Reconcile ${documents.length} record${documents.length === 1 ? "" : "s"}`}
          </Button>
          {record && (
            <Button variant="outline" onClick={() => onNavigate("findings")}>
              View findings
            </Button>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Uploaded documents" value={String(documents.length)} />
        <StatCard label="Medications" value={record ? String(record.medications.length) : "—"} />
        <StatCard label="Lab series" value={record ? String(record.labs.length) : "—"} />
        <StatCard
          label="High-severity findings"
          value={record ? String(highCount) : "—"}
          highlight={highCount > 0}
        />
      </div>

      {reconciledLabel && (
        <p className="text-xs text-muted-foreground">
          Last reconciled {reconciledLabel}
        </p>
      )}

      {stages.length > 0 || documents.length > 0 ? (
        <WorkflowOverview
          documentCount={documents.length}
          pipelineRunning={status === "running"}
          stages={stages}
          compact
        />
      ) : null}

      {stages.length > 0 && (
        <PipelinePanel stages={stages} completedAt={reconciledAt} />
      )}

      {topFindings.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top findings</CardTitle>
            <CardAction>
              <Button variant="ghost" size="sm" onClick={() => onNavigate("findings")}>
                View all
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-3">
            {topFindings.map((insight) => (
              <InsightCard key={insight.id} insight={insight} compact />
            ))}
          </CardContent>
        </Card>
      ) : !record ? (
        <Card>
          <CardContent className="flex flex-col items-center py-10 text-center">
            <Stethoscope className="size-8 text-muted-foreground" />
            <p className="mt-3 max-w-md text-sm text-muted-foreground">
              {documents.length === 0
                ? "Upload medical records, then reconcile to see your dashboard."
                : "Run reconciliation to populate your overview."}
            </p>
            <Button className="mt-4" variant="outline" onClick={() => onNavigate("upload")}>
              Go to uploads
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? "border-red-500/30" : undefined}>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl font-medium tabular-nums tracking-tight">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function UploadView({
  documents,
  loadingDocs,
  uploading,
  storageError,
  status,
  stages,
  reconciledAt,
  record,
  stale,
  staleMessage,
  canReconcile,
  fileInputRef,
  onRun,
  onPickFiles,
  onFilesSelected,
  onRemove,
}: {
  documents: UploadedDocument[];
  loadingDocs: boolean;
  uploading: boolean;
  storageError: string | null;
  status: Status;
  stages: LiveStage[];
  reconciledAt: string | null;
  record: HealthRecord | null;
  stale: boolean;
  staleMessage: string | null;
  canReconcile: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onRun: () => void;
  onPickFiles: () => void;
  onFilesSelected: (files: FileList) => void;
  onRemove: (id: string) => void;
}) {
  const disabled = Boolean(storageError);

  return (
    <div className="space-y-6">
      {stale && staleMessage && (
        <StaleBanner message={staleMessage} onReconcile={onRun} canReconcile={canReconcile} />
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Drop visit summaries, lab reports, and pharmacy printouts (.txt or .pdf).
          </p>
        </div>
        <Button onClick={onRun} disabled={status === "running" || !canReconcile}>
          {status === "running" ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Activity />
          )}
          {status === "running"
            ? "Reconciling…"
            : documents.length === 0
              ? "Upload records to reconcile"
              : stale
                ? "Update reconciliation"
                : record
                  ? "Run again"
                  : `Reconcile ${documents.length} record${documents.length === 1 ? "" : "s"}`}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <UploadPanel
          documents={documents}
          loading={loadingDocs}
          uploading={uploading}
          disabled={disabled}
          fileInputRef={fileInputRef}
          onPickFiles={onPickFiles}
          onFilesSelected={onFilesSelected}
          onRemove={onRemove}
        />
        <div className="min-w-0 space-y-6">
          <WorkflowOverview
            documentCount={documents.length}
            pipelineRunning={status === "running"}
            stages={stages}
          />
          {(status === "running" || (status === "done" && stages.length > 0)) && (
            <PipelinePanel stages={stages} completedAt={reconciledAt} />
          )}
        </div>
      </div>
    </div>
  );
}

function FindingsView({
  record,
  stale,
  reconciledAt,
  onExport,
  onNavigate,
}: {
  record: HealthRecord | null;
  stale: boolean;
  reconciledAt: string | null;
  onExport: () => void;
  onNavigate: (view: DashboardView) => void;
}) {
  if (!record) {
    return (
      <EmptyState
        icon={<ShieldAlert className="size-8" />}
        title="No findings yet"
        description="Upload records and run reconciliation to generate cross-provider safety insights."
        actionLabel="Go to uploads"
        onAction={() => onNavigate("upload")}
      />
    );
  }

  return (
    <FindingsContent
      record={record}
      stale={stale}
      reconciledAt={reconciledAt}
      onExport={onExport}
    />
  );
}

function RecordView({
  record,
  stale,
  onExport,
}: {
  record: HealthRecord | null;
  stale: boolean;
  onExport: () => void;
}) {
  if (!record) {
    return (
      <EmptyState
        icon={<Stethoscope className="size-8" />}
        title="No health record yet"
        description="Reconcile your uploads to build a coded, grounded record."
      />
    );
  }

  return <RecordContent record={record} stale={stale} onExport={onExport} />;
}

function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  actionDisabled,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center py-16 text-center">
        <div className="text-muted-foreground">{icon}</div>
        <h2 className="mt-4 text-base font-medium">{title}</h2>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
        {actionLabel && onAction && (
          <Button className="mt-4" onClick={onAction} disabled={actionDisabled}>
            {actionLabel}
          </Button>
        )}
      </CardContent>
    </Card>
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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="size-4 text-muted-foreground" />
          Your uploads ({documents.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
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
          className={`border border-dashed p-6 text-center transition ${
            dragOver ? "border-foreground/30 bg-muted/40" : "border-border bg-muted/20"
          } ${disabled ? "opacity-50" : ""}`}
        >
          <Upload className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-2 text-sm">Drop medical records here</p>
          <p className="mt-1 text-xs text-muted-foreground">or</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={onPickFiles}
            disabled={disabled || uploading}
          >
            {uploading ? "Uploading…" : "Choose files"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) onFilesSelected(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading uploads…
          </div>
        ) : documents.length === 0 ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            For the demo, upload the five synthetic records from the repo&apos;s{" "}
            <code>demo-data/</code> folder.
          </p>
        ) : (
          documents.map((doc) => (
            <DocumentListItem
              key={doc.id}
              doc={doc}
              disabled={disabled}
              uploading={uploading}
              onRemove={onRemove}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function documentViewUrl(documentId: string) {
  return `/api/documents/${documentId}?inline=1`;
}

function isPdfDocument(doc: UploadedDocument) {
  return doc.mimeType === "application/pdf";
}

function DocumentListItem({
  doc,
  disabled,
  uploading,
  onRemove,
}: {
  doc: UploadedDocument;
  disabled: boolean;
  uploading: boolean;
  onRemove: (id: string) => void;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  async function loadPreview() {
    setPreviewOpen(true);
    if (isPdfDocument(doc)) return;

    if (loadingPreview) return;
    if (previewText !== null && !previewError) return;

    setLoadingPreview(true);
    setPreviewError(null);

    try {
      const res = await fetch(`/api/documents/${doc.id}`);
      const data = (await res.json()) as { text?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load document.");
      setPreviewText(data.text ?? "");
    } catch (err) {
      setPreviewError((err as Error).message);
    } finally {
      setLoadingPreview(false);
    }
  }

  function openInNewTab() {
    window.open(documentViewUrl(doc.id), "_blank", "noopener,noreferrer");
  }

  return (
    <>
      <div className="flex items-start gap-1 border bg-muted/20">
        <button
          type="button"
          onClick={() => void loadPreview()}
          disabled={disabled}
          className="flex min-w-0 flex-1 items-start gap-2 p-3 text-left transition hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{doc.label}</div>
            <div className="truncate text-xs text-muted-foreground">{doc.filename}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{formatBytes(doc.sizeBytes)}</div>
          </div>
        </button>
        <div className="flex shrink-0 flex-col border-l">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-8 rounded-none"
            onClick={openInNewTab}
            disabled={disabled}
            aria-label={`Open ${doc.filename} in new tab`}
          >
            <ExternalLink className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-8 rounded-none border-t"
            onClick={() => onRemove(doc.id)}
            disabled={disabled || uploading}
            aria-label={`Remove ${doc.filename}`}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      <Sheet open={previewOpen} onOpenChange={setPreviewOpen}>
        <SheetContent side="right" className="flex h-full w-full flex-col sm:max-w-2xl">
          <SheetHeader className="border-b pb-4">
            <SheetTitle>{doc.label}</SheetTitle>
            <SheetDescription>
              {doc.filename} · {formatBytes(doc.sizeBytes)}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
            {isPdfDocument(doc) ? (
              <iframe
                src={documentViewUrl(doc.id)}
                title={doc.filename}
                className="h-full min-h-[70vh] w-full border bg-white"
              />
            ) : loadingPreview ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading…
              </div>
            ) : previewError ? (
              <p className="text-sm text-destructive">{previewError}</p>
            ) : (
              <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground">
                {previewText}
              </pre>
            )}
          </div>
          <SheetFooter className="flex-row justify-end gap-2 border-t pt-4">
            <Button variant="outline" size="sm" onClick={openInNewTab}>
              <ExternalLink /> Open in new tab
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

function FindingsContent({
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

  const isFallback = record.meta?.pipeline === "fallback";
  const hasWebCitations =
    (record.webSources?.length ?? 0) > 0 || record.insights.some((i) => i.citationUrl);

  return (
    <div className={`space-y-6 ${stale ? "opacity-80" : ""}`}>
      <RecordAlerts
        isFallback={isFallback}
        hasWebCitations={hasWebCitations}
        pipeline={record.meta?.pipeline}
      />

      {(savedLabel || stale || record.meta?.pipeline === "live") && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {savedLabel && <span>{savedLabel}</span>}
          {record.meta?.pipeline === "live" && (
            <Badge variant="outline">Live Grok</Badge>
          )}
          {stale && (
            <Badge variant="outline" className="border-amber-500/30 text-amber-300">
              May be outdated
            </Badge>
          )}
        </div>
      )}

      {record.webSources && record.webSources.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Web sources ({record.webSources.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {record.webSources.map((s) => (
                <li key={s.url}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-foreground underline-offset-2 hover:underline"
                  >
                    {s.title?.trim() || s.url} ↗
                  </a>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-medium">
          <ShieldAlert className="size-4 text-red-400" />
          Findings ({record.insights.length})
        </h2>
        <Button variant="outline" size="sm" onClick={onExport}>
          <Download /> Export FHIR
        </Button>
      </div>

      <div className="space-y-3">
        {sorted.map((i) => (
          <InsightCard key={i.id} insight={i} />
        ))}
      </div>
    </div>
  );
}

function RecordContent({
  record,
  stale,
  onExport,
}: {
  record: HealthRecord;
  stale: boolean;
  onExport: () => void;
}) {
  return (
    <div className={`space-y-6 ${stale ? "opacity-80" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            {record.patient.name}
            {record.patient.dob ? ` · DOB ${record.patient.dob}` : ""}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onExport}>
          <Download /> Export FHIR
        </Button>
      </div>

      <Tabs defaultValue="medications">
        <TabsList>
          <TabsTrigger value="medications">
            Medications ({record.medications.length})
          </TabsTrigger>
          <TabsTrigger value="labs">Labs ({record.labs.length})</TabsTrigger>
          <TabsTrigger value="conditions">Conditions ({record.conditions.length})</TabsTrigger>
          <TabsTrigger value="allergies">Allergies ({record.allergies.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="medications" className="mt-4">
          <SectionCard title="Medications" icon={<Pill className="size-4 text-muted-foreground" />}>
            <div className="space-y-2.5">
              {record.medications.map((m) => (
                <MedRow key={m.id} med={m} />
              ))}
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="labs" className="mt-4">
          <SectionCard title="Labs & trends" icon={<FlaskConical className="size-4 text-muted-foreground" />}>
            <div className="space-y-3">
              {record.labs.map((lab) => (
                <div key={lab.id}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{lab.display}</span>
                    <TrendBadge trend={lab.trend} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {lab.series.map((p, idx) => (
                      <span
                        key={idx}
                        className="bg-muted px-1.5 py-0.5 font-mono text-xs"
                        title={p.reported ? `reported: ${p.reported}` : undefined}
                      >
                        {p.value ?? p.reported} {p.value != null ? p.unit : ""}
                        {p.reported && p.normalizedValue ? " ⚐" : ""}
                      </span>
                    ))}
                  </div>
                  {lab.loinc && <CodeChip system="LOINC" code={lab.loinc} />}
                  <ProvenanceChips provenance={lab.provenance} className="mt-1.5" />
                </div>
              ))}
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="conditions" className="mt-4">
          <SectionCard title="Conditions" icon={<Activity className="size-4 text-muted-foreground" />}>
            <div className="space-y-2">
              {record.conditions.map((c) => (
                <div key={c.id} className="text-sm">
                  <div className="flex items-center gap-2">
                    <span>{c.display}</span>
                    {c.inferred && (
                      <Badge variant="outline" className="border-amber-500/30 text-amber-300">
                        inferred
                      </Badge>
                    )}
                  </div>
                  <div className="mt-0.5 flex gap-1.5">
                    {c.icd10 && <CodeChip system="ICD-10" code={c.icd10} />}
                    {c.snomed && <CodeChip system="SNOMED" code={c.snomed} />}
                  </div>
                  <ProvenanceChips provenance={c.provenance} className="mt-1.5" />
                </div>
              ))}
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="allergies" className="mt-4">
          <SectionCard title="Allergies" icon={<AlertTriangle className="size-4 text-muted-foreground" />}>
            {record.allergies.map((a) => (
              <div key={a.id} className="text-sm">
                <span>{a.display}</span>
                {a.reaction && <span className="text-muted-foreground"> · {a.reaction}</span>}
                <div className="mt-1">
                  {a.snomed && <CodeChip system="SNOMED" code={a.snomed} />}
                </div>
                <ProvenanceChips provenance={a.provenance} className="mt-1.5" />
              </div>
            ))}
          </SectionCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RecordAlerts({
  isFallback,
  hasWebCitations,
  pipeline,
}: {
  isFallback: boolean;
  hasWebCitations: boolean;
  pipeline?: "live" | "fallback";
}) {
  if (isFallback) {
    return (
      <Alert className="border-amber-500/40 text-amber-300">
        <AlertTitle>Reference record</AlertTitle>
        <AlertDescription>
          Grok was unavailable. Run reconciliation again for live analysis with verified citations.
        </AlertDescription>
      </Alert>
    );
  }
  if (!hasWebCitations && pipeline === "live") {
    return (
      <Alert className="border-amber-500/40 text-amber-300">
        <AlertTitle>Analysis incomplete</AlertTitle>
        <AlertDescription>
          Reconciliation succeeded but web search did not complete. Run again to retry citations.
        </AlertDescription>
      </Alert>
    );
  }
  if (!hasWebCitations && !pipeline) {
    return (
      <Alert>
        <AlertDescription>
          No web citations on this saved record. Run again to re-analyze with live Grok web search.
        </AlertDescription>
      </Alert>
    );
  }
  return null;
}

function InsightCard({ insight, compact }: { insight: Insight; compact?: boolean }) {
  const s = SEVERITY[insight.severity];
  return (
    <div className={`border ${s.ring} ${s.bg} p-4 ${compact ? "p-3" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          {insight.severity === "high" ? (
            <ShieldAlert className={`size-4 ${s.text}`} />
          ) : (
            <AlertTriangle className={`size-4 ${s.text}`} />
          )}
          <h3 className="text-sm font-semibold">{insight.title}</h3>
        </div>
        <Badge variant="outline" className={`shrink-0 ${s.ring} ${s.text}`}>
          {s.label}
        </Badge>
      </div>
      {!compact && (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{insight.explanation}</p>
      )}
      {compact && (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{insight.explanation}</p>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {insight.crossProvider && (
          <Badge variant="secondary">cross-provider</Badge>
        )}
        {insight.citationUrl && (
          <a
            href={insight.citationUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-foreground underline-offset-2 hover:underline"
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
    <div className="border bg-muted/20 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{med.display}</span>
        {med.status === "acute" && (
          <span className="border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">acute</span>
        )}
      </div>
      {med.sig && <div className="text-xs text-muted-foreground">{med.sig}</div>}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {med.rxnorm && <CodeChip system="RxNorm" code={med.rxnorm} />}
        {med.aliases && med.aliases.length > 1 && (
          <span className="text-[10px] text-muted-foreground">merged from {med.aliases.length} names</span>
        )}
        {med.reviewNeeded && (
          <span className="border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
            duplicate risk
          </span>
        )}
      </div>
      <div className="mt-1.5">
        <ProvenanceChips provenance={med.provenance} />
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
    <span className="bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
      {system} {code}
    </span>
  );
}

function SectionCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {icon} {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
