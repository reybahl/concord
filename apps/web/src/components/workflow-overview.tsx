"use client";

import { ArrowRight, Ear, FileStack, Layers, Search, ShieldCheck, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { PipelineStageSnapshot } from "@/lib/pipeline-log";

const STEPS = [
  {
    id: "upload",
    icon: Upload,
    title: "Upload",
    headline: "Collect the silos",
    body: "Five providers → five records. Different names, codes, and units. Nothing talks to each other yet.",
    youDo: "Drop the demo files (PCP, cardiology, urgent care, lab, pharmacy).",
  },
  {
    id: "extract",
    pipelineStages: ["ingest", "extract"],
    icon: FileStack,
    title: "Extract",
    headline: "Read each document separately",
    body: "Grok pulls structured facts from every source — with a verbatim quote per fact. Still five separate views.",
    youDo: "Watch per-document counts appear (meds · labs · conditions).",
  },
  {
    id: "reconcile",
    pipelineStages: ["reconcile"],
    icon: Layers,
    title: "Reconcile",
    headline: "Merge into one patient",
    body: "The hard step: same person, one drug list, standard codes, lab units normalized, duplicates collapsed.",
    youDo: "Expand this step in the pipeline — identity notes and merge lines live here.",
  },
  {
    id: "verify",
    pipelineStages: ["verify"],
    icon: Search,
    title: "Verify",
    headline: "Ground every fact",
    body: "Every medication and lab must trace back to a source quote. No provenance → flagged.",
    youDo: "Check the grounded count; hover facts in Health record later.",
  },
  {
    id: "analyze",
    pipelineStages: ["analyze"],
    icon: ShieldCheck,
    title: "Findings",
    headline: "See what no one provider could",
    body: "Cross-provider interactions, trends, care gaps — with web-search citations (FDA, NIH, CDC).",
    youDo: "Open Findings for the hero catch (e.g. clarithromycin + simvastatin).",
  },
  {
    id: "guardian",
    icon: Ear,
    title: "Guardian",
    headline: "Protect at the point of care",
    body: "Realtime voice listens in a visit; server-side Grok checks new orders against the reconciled record.",
    youDo: "Separate tab — room sim + Guardian catches unsafe orders aloud.",
  },
] as const;

type PipelineStageName = "ingest" | "extract" | "reconcile" | "verify" | "analyze";

function stepPipelineStages(step: (typeof STEPS)[number]): readonly PipelineStageName[] | null {
  if (!("pipelineStages" in step)) return null;
  return step.pipelineStages;
}

type StepId = (typeof STEPS)[number]["id"];

function activeStepId(
  documentCount: number,
  pipelineRunning: boolean,
  stages: PipelineStageSnapshot[],
): StepId {
  if (documentCount === 0) return "upload";
  if (!pipelineRunning && stages.every((s) => s.status === "done")) return "guardian";
  const running = stages.find((s) => s.status === "start");
  if (running) {
    const match = STEPS.find((step) => {
      const ps = stepPipelineStages(step);
      return ps?.includes(running.stage as PipelineStageName);
    });
    if (match) return match.id;
  }
  if (documentCount > 0 && stages.length === 0) return "upload";
  return "extract";
}

export function WorkflowOverview({
  documentCount,
  pipelineRunning,
  stages,
  compact,
}: {
  documentCount: number;
  pipelineRunning: boolean;
  stages: PipelineStageSnapshot[];
  /** Smaller layout for overview page */
  compact?: boolean;
}) {
  const active = activeStepId(documentCount, pipelineRunning, stages);
  const activeIndex = STEPS.findIndex((s) => s.id === active);

  return (
    <Card className="border-border/80">
      <CardHeader className={compact ? "pb-2" : undefined}>
        <CardTitle className="text-base">How Concord works</CardTitle>
        <CardDescription className="max-w-2xl text-xs leading-relaxed">
          One patient, many providers — each only ever saw their slice. Concord builds the full picture,
          then watches for mistakes at the bedside.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className={`grid gap-2 ${compact ? "sm:grid-cols-2" : "lg:grid-cols-3"}`}>
          {STEPS.map((step, index) => {
            const Icon = step.icon;
            const isActive = step.id === active;
            const isPast = index < activeIndex;
            return (
              <li
                key={step.id}
                className={`rounded-md border px-3 py-2.5 transition-colors ${
                  isActive
                    ? "border-emerald-500/40 bg-emerald-500/5"
                    : isPast
                      ? "border-border/50 bg-muted/20 opacity-80"
                      : "border-border/40 bg-muted/5"
                }`}
              >
                <div className="flex items-start gap-2">
                  <Icon
                    className={`mt-0.5 size-4 shrink-0 ${isActive ? "text-emerald-400" : "text-muted-foreground"}`}
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-medium">{step.title}</span>
                      {isActive && (
                        <Badge variant="outline" className="h-4 px-1.5 text-[9px] text-emerald-300">
                          {pipelineRunning ? "Now" : "Next"}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] font-medium text-foreground/90">{step.headline}</p>
                    {!compact && (
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{step.body}</p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        {!compact && (
          <div className="rounded-md border border-dashed border-border/70 bg-muted/10 px-3 py-2.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Right now
            </p>
            <p className="mt-1 text-xs leading-relaxed text-foreground/90">
              {documentCount === 0 ? (
                <>
                  <span className="font-medium">Upload</span> the five demo documents, then press Reconcile.
                  The pipeline below walks through extract → reconcile → verify → analyze.
                </>
              ) : pipelineRunning ? (
                <>
                  Concord is on <span className="font-medium">{STEPS[activeIndex]?.title ?? "a step"}</span>.
                  Expand that step in the pipeline log to see Grok&apos;s live output.
                </>
              ) : stages.length > 0 ? (
                <>
                  Reconciliation finished. Open <span className="font-medium">Findings</span> for cross-provider
                  insights, then <span className="font-medium">Guardian</span> for the live visit demo.
                </>
              ) : (
                <>
                  {documentCount} document{documentCount === 1 ? "" : "s"} ready — press{" "}
                  <span className="font-medium">Reconcile</span> to start. Extract and reconcile are automatic;
                  you just watch the log.
                </>
              )}
            </p>
          </div>
        )}

        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <ArrowRight className="size-3 shrink-0" />
          Demo arc: upload → reconcile (expand log) → findings hero → Guardian speaks in the room
        </p>
      </CardContent>
    </Card>
  );
}
