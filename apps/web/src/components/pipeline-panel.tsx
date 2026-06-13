"use client";

import { CheckCircle2, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { PipelineStageSnapshot } from "@/lib/pipeline-log";

const STAGE_GUIDE: Record<
  string,
  {
    headline: string;
    what: string;
    grok?: string;
    looksFor: string[];
  }
> = {
  ingest: {
    headline: "Queue your uploads",
    what: "Concord loads each file you uploaded (.txt or .pdf) and prepares it for extraction. Nothing is merged yet — this is just inventory.",
    looksFor: ["Which documents are in this run", "File labels from your upload list"],
  },
  extract: {
    headline: "Pull facts from each document",
    what: "Grok reads every source independently and returns structured mentions — meds, labs, conditions, allergies — each tied to a verbatim quote from that document. Brand names stay as written (Glucophage, Zestril); coding comes later.",
    grok: "grok-4-fast-non-reasoning",
    looksFor: [
      "Per-document counts (meds · labs · conditions · allergies)",
      "Source system read from letterhead (e.g. CVS, cardiology)",
      "Every fact keeps a textSpan quote for grounding",
    ],
  },
  reconcile: {
    headline: "Merge into one patient record",
    what: "This is the pharmacist-style step: confirm all documents are the same person, collapse brand/generic/NDC duplicates into one drug, assign RxNorm/LOINC/SNOMED/ICD-10 codes, build lab time-series, convert units (e.g. A1c mmol/mol → %), and infer conditions labs imply but no one coded.",
    grok: "grok-4-fast-reasoning",
    looksFor: [
      "Identity notes (Gonzalez vs Gonzales, different MRNs)",
      "Merge notes (Lisinopril + Zestril → one entry)",
      "Medication alias lines and reviewNeeded flags",
      "Lab unit normalization and inferred conditions (e.g. CKD from eGFR trend)",
    ],
  },
  verify: {
    headline: "Ground every fact",
    what: "A deterministic check — no model call. Every medication, lab, condition, and allergy must point back to at least one source document and quote. Anything missing provenance is flagged.",
    looksFor: ["X/Y facts grounded", "Flags for facts with no source quote", "Medications marked reviewNeeded"],
  },
  analyze: {
    headline: "Cross-provider safety findings",
    what: "Grok reasons over the reconciled record and searches FDA/NIH/CDC sources for interactions, duplicate therapy, lab trends, and care gaps that only appear when you combine all providers.",
    grok: "grok-4-fast-reasoning + web_search",
    looksFor: [
      "Web search queries and source counts",
      "Findings by severity ([HIGH], [MEDIUM], …)",
      "Hero interaction: e.g. clarithromycin + simvastatin across urgent care + PCP",
    ],
  },
};

const NOTE_LABEL: Record<string, string> = {
  info: "Info",
  merge: "Merge / normalize",
  model: "Model progress",
  flag: "Flagged",
};

function groupNotes(notes: PipelineStageSnapshot["notes"]) {
  const heartbeats = notes.filter((n) => n.slot === "reconcile-status");
  const identity = notes.filter(
    (n) => n.slot?.startsWith("identity") || n.slot === "reconcile-patient" || (n.tone === "info" && n.text.startsWith("Patient:")),
  );
  const merges = notes.filter(
    (n) =>
      n.tone === "merge" ||
      n.slot?.startsWith("alias-") ||
      n.slot?.startsWith("lab-unit-") ||
      n.slot?.startsWith("merge-"),
  );
  const inferred = notes.filter((n) => n.slot?.startsWith("inferred-"));
  const findings = notes.filter((n) => n.text.startsWith("[HIGH]") || n.text.startsWith("[MEDIUM]") || n.text.startsWith("[LOW]"));
  const searches = notes.filter((n) => n.text.startsWith("Web search"));
  const documents = notes.filter(
    (n) =>
      n.tone === "model" &&
      n.text.includes(" meds · ") &&
      !n.slot?.startsWith("reconcile"),
  );
  const queued = notes.filter((n) => n.tone === "info" && !identity.includes(n) && !findings.includes(n) && !searches.includes(n));
  const rest = notes.filter(
    (n) =>
      !heartbeats.includes(n) &&
      !identity.includes(n) &&
      !merges.includes(n) &&
      !inferred.includes(n) &&
      !findings.includes(n) &&
      !searches.includes(n) &&
      !documents.includes(n) &&
      !queued.includes(n),
  );

  return [
    { title: "Documents read", items: queued.length ? queued : documents, defaultOpen: true },
    { title: "Per-document extraction", items: documents, defaultOpen: true },
    { title: "Patient identity", items: identity, defaultOpen: true },
    { title: "Merges & unit normalization", items: merges, defaultOpen: true },
    { title: "Inferred conditions", items: inferred, defaultOpen: true },
    { title: "Web searches", items: searches, defaultOpen: false },
    { title: "Findings surfaced", items: findings, defaultOpen: true },
    { title: "Progress", items: heartbeats, defaultOpen: false },
    { title: "Other", items: rest, defaultOpen: false },
  ].filter((g) => g.items.length > 0);
}

function NoteList({ items }: { items: PipelineStageSnapshot["notes"] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((n, i) => (
        <li
          key={n.slot ?? `${n.text}-${i}`}
          className={`border-l-2 pl-2.5 text-xs leading-relaxed ${
            n.tone === "flag"
              ? "border-amber-500/50 text-amber-300"
              : n.tone === "merge"
                ? "border-sky-500/40 text-sky-200/90"
                : "border-border text-muted-foreground"
          }`}
        >
          {n.tone && n.tone !== "info" && (
            <span className="mr-1.5 font-medium uppercase tracking-wide opacity-70">
              {NOTE_LABEL[n.tone] ?? n.tone}:
            </span>
          )}
          {n.text}
        </li>
      ))}
    </ul>
  );
}

function StageRow({ stage, defaultExpanded }: { stage: PipelineStageSnapshot; defaultExpanded: boolean }) {
  const [open, setOpen] = useState(defaultExpanded);
  const guide = STAGE_GUIDE[stage.stage];
  const groups = groupNotes(stage.notes);
  const hasDetails = Boolean(guide || stage.detail || stage.notes.length > 0);

  return (
    <li className="rounded-md border border-border/60 bg-muted/10">
      <button
        type="button"
        onClick={() => hasDetails && setOpen((v) => !v)}
        disabled={!hasDetails}
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left disabled:cursor-default"
      >
        <span className="mt-0.5 shrink-0">
          {stage.status === "done" ? (
            <CheckCircle2 className="size-5 text-emerald-400/80" />
          ) : (
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className={`text-sm font-medium ${stage.status === "done" ? "text-foreground" : ""}`}>
              {guide?.headline ?? stage.label}
            </span>
            {stage.status === "start" && (
              <Badge variant="outline" className="text-[10px]">
                Running
              </Badge>
            )}
          </span>
          {stage.detail && (
            <span className="mt-0.5 block text-xs text-muted-foreground">{stage.detail}</span>
          )}
        </span>
        {hasDetails && (
          <span className="mt-0.5 shrink-0 text-muted-foreground">
            {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </span>
        )}
      </button>

      {open && hasDetails && (
        <div className="space-y-4 border-t border-border/50 px-3 pb-3 pt-3">
          {guide && (
            <div className="space-y-2">
              <p className="text-xs leading-relaxed text-muted-foreground">{guide.what}</p>
              {guide.grok && (
                <p className="text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground/80">Grok:</span> {guide.grok}
                </p>
              )}
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  What to look for in the log
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                  {guide.looksFor.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {groups.length > 0 && (
            <div className="space-y-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                What happened this run
              </p>
              {groups.map((g) => (
                <div key={g.title}>
                  <p className="mb-1 text-xs font-medium text-foreground/90">{g.title}</p>
                  <NoteList items={g.items} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function PipelinePanel({
  stages,
  completedAt,
}: {
  stages: PipelineStageSnapshot[];
  completedAt?: string | null;
}) {
  const runningStage = stages.find((s) => s.status === "start")?.stage;
  const completedLabel = completedAt
    ? new Date(completedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : null;

  return (
    <Card>
      <CardHeader className="space-y-1">
        <div className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">Reconciliation pipeline</CardTitle>
          {completedLabel && (
            <span className="shrink-0 text-xs text-muted-foreground">Completed {completedLabel}</span>
          )}
        </div>
        <CardDescription className="text-xs leading-relaxed">
          Click any step to see what it does and the live log from this run. Reconcile is usually the
          step worth expanding — that&apos;s where cross-document merging happens.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="space-y-2">
          {stages.map((s) => (
            <StageRow key={s.stage} stage={s} defaultExpanded={s.stage === runningStage || s.stage === "reconcile"} />
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
