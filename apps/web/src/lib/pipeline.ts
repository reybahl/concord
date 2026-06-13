import { DEMO_DOCS } from "./demo-documents";
import { hasXai } from "./grok";
import { MOCK_RECORD } from "./mock-record";
import type { HealthRecord, PipelineEvent, SourceDoc } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface StageDef {
  stage: string;
  label: string;
  detail: (docs: SourceDoc[], record: HealthRecord) => string;
  delay: number;
}

/** The reconciliation pipeline, surfaced to the UI as discrete, narratable stages. */
const STAGES: StageDef[] = [
  {
    stage: "ingest",
    label: "Reading source documents",
    detail: (docs) => `${docs.length} records from ${new Set(docs.map((d) => d.system)).size} systems`,
    delay: 500,
  },
  {
    stage: "extract",
    label: "Extracting clinical facts",
    detail: (_d, r) =>
      `${r.medications.length} meds, ${r.labs.length} labs, ${r.conditions.length} conditions, ${r.allergies.length} allergy`,
    delay: 900,
  },
  {
    stage: "code",
    label: "Mapping to RxNorm / LOINC / SNOMED",
    detail: () => "normalizing brand names, NDCs and units to standard codes",
    delay: 800,
  },
  {
    stage: "reconcile",
    label: "Resolving identity & merging duplicates",
    detail: () => "1 patient across 5 MRNs · Lisinopril = Zestril · A1c units unified",
    delay: 900,
  },
  {
    stage: "verify",
    label: "Grounding every fact to a source",
    detail: (_d, r) => {
      const total =
        r.medications.length + r.labs.length + r.conditions.length + r.allergies.length;
      return `${total} facts, each traced to its origin document`;
    },
    delay: 700,
  },
  {
    stage: "analyze",
    label: "Cross-provider safety analysis",
    detail: (_d, r) => {
      const high = r.insights.filter((i) => i.severity === "high").length;
      return `${r.insights.length} findings · ${high} high-severity`;
    },
    delay: 1000,
  },
];

/**
 * Run the reconciliation pipeline, yielding stage events then the final record.
 *
 * Today this returns the deterministic golden record (no key required). The live
 * Grok path slots in at the `extract`/`reconcile`/`analyze` stages behind `hasXai`
 * without changing this event contract or the UI.
 */
export async function* runPipeline(
  docs: SourceDoc[] = DEMO_DOCS,
): AsyncGenerator<PipelineEvent> {
  const record: HealthRecord = { ...MOCK_RECORD, sources: docs };

  for (const s of STAGES) {
    yield { type: "stage", stage: s.stage, label: s.label, status: "start" };
    await sleep(s.delay);
    yield {
      type: "stage",
      stage: s.stage,
      label: s.label,
      status: "done",
      detail: s.detail(docs, record),
    };
  }

  yield { type: "result", record };
}

export { hasXai };
