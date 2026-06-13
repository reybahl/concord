import {
  ArrowRight,
  Ear,
  FileStack,
  Layers,
  Search,
  ShieldCheck,
  Upload,
  type LucideIcon,
} from "lucide-react";

export interface ConcordWorkflowStep {
  id: string;
  icon: LucideIcon;
  title: string;
  description: string;
}

export const CONCORD_WORKFLOW_STEPS: ConcordWorkflowStep[] = [
  {
    id: "upload",
    icon: Upload,
    title: "Upload",
    description:
      "Five providers, five records — different names, codes, and units. Collect every source before anything merges.",
  },
  {
    id: "extract",
    icon: FileStack,
    title: "Extract",
    description:
      "Grok reads each document separately and pulls structured facts with a verbatim quote per item.",
  },
  {
    id: "reconcile",
    icon: Layers,
    title: "Reconcile",
    description:
      "Merge into one patient: deduplicated meds, standard codes, normalized lab units, matched identity.",
  },
  {
    id: "verify",
    icon: Search,
    title: "Verify",
    description: "Every fact must trace back to a source quote. Missing provenance gets flagged.",
  },
  {
    id: "analyze",
    icon: ShieldCheck,
    title: "Findings",
    description:
      "Cross-provider interactions, trends, and care gaps — with citations from FDA, NIH, and CDC.",
  },
  {
    id: "guardian",
    icon: Ear,
    title: "Guardian",
    description:
      "Listens during a live visit and checks new orders against your full record — speaks up only when unsafe.",
  },
];

interface ConcordWorkflowSectionProps {
  /** Show numbered step markers */
  numbered?: boolean;
  className?: string;
}

export function ConcordWorkflowSection({ numbered, className }: ConcordWorkflowSectionProps) {
  return (
    <section className={className}>
      <div className="mb-6 max-w-2xl">
        <h2 className="text-lg font-medium tracking-tight">How Concord works</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          One patient, many providers — each only ever saw their slice. Concord builds the full picture,
          then watches for mistakes at the bedside.
        </p>
      </div>

      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CONCORD_WORKFLOW_STEPS.map((step, index) => {
          const Icon = step.icon;
          return (
            <li
              key={step.id}
              className="rounded-lg border border-border/60 bg-muted/10 px-4 py-3.5"
            >
              <div className="flex items-start gap-3">
                <div className="flex size-8 shrink-0 items-center justify-center border border-border/60 bg-background/50">
                  <Icon className="size-4 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {numbered && (
                      <span className="font-mono text-[10px] text-muted-foreground">{index + 1}</span>
                    )}
                    <span className="text-sm font-medium">{step.title}</span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{step.description}</p>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <p className="mt-6 flex items-center gap-1.5 text-xs text-muted-foreground">
        <ArrowRight className="size-3.5 shrink-0" />
        Merge → find cross-provider risks → protect live at the bedside
      </p>
    </section>
  );
}
