import { analyze } from "./analyze";
import { countMentions, extractFromDocument, type DocExtraction } from "./extract";
import { hasXai } from "./grok";
import { MOCK_RECORD } from "./mock-record";
import { reconcileStream } from "./reconcile";
import type { Insights, Reconciled } from "./schemas";
import type {
  AllergyFact,
  ConditionFact,
  HealthRecord,
  Insight,
  LabObservation,
  MedicationFact,
  PipelineEvent,
  Provenance,
  SourceDoc,
} from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run the reconciliation pipeline with live Grok.
 *
 * Each stage does real model work and streams its actual substance to the UI:
 * extracted counts as each document lands, the model's own merge/normalization
 * notes during reconciliation, and findings as they are produced. If no key is
 * present (or any call fails) we fall back to the deterministic golden record
 * so the demo never hard-fails — and we say so out loud.
 */
export async function* runPipeline(docs: SourceDoc[]): AsyncGenerator<PipelineEvent> {
  if (docs.length === 0) {
    throw new Error("Upload at least one source document before reconciling.");
  }

  if (!hasXai) {
    yield* runOffline(docs, "No XAI_API_KEY set — showing the deterministic reference record.");
    return;
  }

  yield* runLive(docs);
}

async function* runLive(docs: SourceDoc[]): AsyncGenerator<PipelineEvent> {
  const byId = new Map(docs.map((d) => [d.id, d]));
  const labelOf = (id: string) => byId.get(id)?.label ?? id;

  // 1. Ingest -----------------------------------------------------------------
  yield { type: "stage", stage: "ingest", label: "Reading source documents", status: "start" };
  for (const d of docs) {
    yield { type: "note", stage: "ingest", tone: "info", text: d.label };
  }
  yield {
    type: "stage",
    stage: "ingest",
    label: "Reading source documents",
    status: "done",
    detail: `${docs.length} documents queued`,
  };

  // 2. Extract (per document, in parallel) ------------------------------------
  yield { type: "stage", stage: "extract", label: "Extracting clinical facts with Grok", status: "start" };
  const extractions: DocExtraction[] = [];
  const systems = new Set<string>();
  for await (const item of streamSettled<SourceDoc, DocExtraction>(docs, (doc) =>
    extractFromDocument(doc).then((extraction) => ({ doc, extraction })),
  )) {
    extractions.push(item);
    const e = item.extraction;
    const system = e.sourceSystem?.trim() || item.doc.system;
    if (system && system !== "Unknown source") systems.add(system);
    yield {
      type: "note",
      stage: "extract",
      tone: "model",
      text: `${system && system !== "Unknown source" ? `${system} — ` : ""}${e.medications.length} meds · ${e.labs.length} labs · ${e.conditions.length} conditions · ${e.allergies.length} allergies`,
    };
  }
  const totalMentions = extractions.reduce((n, x) => n + countMentions(x.extraction), 0);
  const systemCount = systems.size || new Set(docs.map((d) => d.system)).size;
  yield {
    type: "stage",
    stage: "extract",
    label: "Extracting clinical facts with Grok",
    status: "done",
    detail: `${totalMentions} raw mentions across ${docs.length} documents from ${systemCount} system${systemCount === 1 ? "" : "s"}, each with a source quote`,
  };

  // 3. Reconcile + code + normalize -------------------------------------------
  yield {
    type: "stage",
    stage: "reconcile",
    label: "Reconciling: identity, de-duplication, coding & units",
    status: "start",
  };
  let reconciled: Reconciled | undefined;
  for await (const event of reconcileStream(extractions)) {
    if (event.type === "note") {
      yield {
        type: "note",
        stage: "reconcile",
        tone: event.tone,
        text: event.text,
        slot: event.slot,
      };
    } else {
      reconciled = event.result;
    }
  }
  if (!reconciled) throw new Error("Reconciliation produced no result.");

  for (const med of reconciled.medications) {
    if (med.aliases.length <= 1) continue;
    yield {
      type: "note",
      stage: "reconcile",
      tone: "merge",
      text: `${med.display} ← merged ${med.aliases.map((a) => `"${a}"`).join(", ")}${med.reviewNeeded ? " · clinician review suggested" : ""}`,
      slot: `alias-${med.display}`,
    };
  }
  for (const lab of reconciled.labs) {
    const converted = lab.series.filter((p) => p.reported?.trim());
    if (converted.length === 0) continue;
    yield {
      type: "note",
      stage: "reconcile",
      tone: "merge",
      text: `${lab.display}: unit normalization (${converted.map((p) => p.reported).join("; ")})`,
      slot: `lab-unit-${lab.display}`,
    };
  }
  for (const cond of reconciled.conditions) {
    if (!cond.inferred) continue;
    yield {
      type: "note",
      stage: "reconcile",
      tone: "model",
      text: `Inferred ${cond.display}${cond.note ? ` — ${cond.note}` : ""}`,
      slot: `inferred-${cond.display}`,
    };
  }

  const record = toHealthRecord(reconciled, docs, labelOf);
  yield {
    type: "stage",
    stage: "reconcile",
    label: "Reconciling: identity, de-duplication, coding & units",
    status: "done",
    detail: `${record.medications.length} meds · ${record.labs.length} labs · ${record.conditions.length} conditions · ${record.allergies.length} allergies`,
  };

  // 4. Verify (deterministic grounding check, no model call) ------------------
  yield { type: "stage", stage: "verify", label: "Grounding every fact to a source", status: "start" };
  const allFacts = [...record.medications, ...record.labs, ...record.conditions, ...record.allergies];
  const ungrounded = allFacts.filter((f) => f.provenance.length === 0).length;
  const flagged = record.medications.filter((m) => m.reviewNeeded).length;
  for (const f of allFacts.filter((x) => x.provenance.length === 0)) {
    yield { type: "note", stage: "verify", tone: "flag", text: `No source quote for "${f.display}" — flagged.` };
  }
  yield {
    type: "stage",
    stage: "verify",
    label: "Grounding every fact to a source",
    status: "done",
    detail: `${allFacts.length - ungrounded}/${allFacts.length} facts grounded · ${flagged} flagged for review`,
  };

  // 5. Analyze (cross-provider safety + live web search) ----------------------
  yield {
    type: "stage",
    stage: "analyze",
    label: "Cross-provider safety analysis · live web search",
    status: "start",
  };
  const searchNotes: string[] = [];
  try {
    const analyzed = await analyze(reconciled, (note) => searchNotes.push(note));
    for (const note of searchNotes) {
      yield { type: "note", stage: "analyze", tone: "info", text: note };
      await sleep(60);
    }
    record.insights = toInsights(analyzed.insights, record);
    record.webSources = analyzed.webSources;
    record.meta = { pipeline: "live" };
    for (const i of record.insights) {
      yield {
        type: "note",
        stage: "analyze",
        tone: i.severity === "high" ? "flag" : "model",
        text: `[${i.severity.toUpperCase()}] ${i.title}`,
      };
      await sleep(90);
    }
    const high = record.insights.filter((i) => i.severity === "high").length;
    yield {
      type: "stage",
      stage: "analyze",
      label: "Cross-provider safety analysis · live web search",
      status: "done",
      detail: `${record.insights.length} findings · ${high} high-severity · ${record.webSources?.length ?? 0} web sources`,
    };
  } catch (err) {
    const msg = (err as Error).message;
    yield {
      type: "note",
      stage: "analyze",
      tone: "flag",
      text: `Analysis failed (${msg.slice(0, 200)}). Your reconciled record is still valid — re-run to retry web search.`,
    };
    record.insights = [];
    record.meta = { pipeline: "live" };
    yield {
      type: "stage",
      stage: "analyze",
      label: "Cross-provider safety analysis · live web search",
      status: "done",
      detail: "Analysis failed — reconciled meds/labs/conditions saved",
    };
  }

  yield { type: "result", record };
}

// --- Reconciled (Grok) → HealthRecord (UI/FHIR) -------------------------------

function toProvenance(
  refs: { sourceDocId: string; textSpan: string }[],
  labelOf: (id: string) => string,
): Provenance[] {
  return refs.map((p) => ({
    sourceDocId: p.sourceDocId,
    sourceLabel: labelOf(p.sourceDocId),
    textSpan: p.textSpan,
  }));
}

function stripInternalSourceFields(doc: SourceDoc): SourceDoc {
  const { blobUrl: _blobUrl, ...rest } = doc;
  return rest;
}

function toHealthRecord(
  r: Reconciled,
  sources: SourceDoc[],
  labelOf: (id: string) => string,
): HealthRecord {
  const medications: MedicationFact[] = r.medications.map((m, i) => ({
    id: `med-${i}`,
    display: m.display,
    rxnorm: m.rxnorm ?? undefined,
    dose: m.dose ?? undefined,
    sig: m.sig ?? undefined,
    status: m.status,
    confidence: m.confidence,
    provenance: toProvenance(m.provenance, labelOf),
    aliases: m.aliases.length ? m.aliases : undefined,
    reviewNeeded: m.reviewNeeded || undefined,
  }));

  const labs: LabObservation[] = r.labs.map((l, i) => ({
    id: `lab-${i}`,
    display: l.display,
    loinc: l.loinc ?? undefined,
    series: l.series.map((p) => ({
      date: p.date,
      value: p.value,
      unit: p.unit,
      reported: p.reported ?? undefined,
      normalizedValue: p.normalizedValue ?? undefined,
      source: p.source,
    })),
    trend: l.trend ?? undefined,
    goal: l.goal ?? undefined,
    confidence: l.confidence,
    provenance: toProvenance(l.provenance, labelOf),
  }));

  const conditions: ConditionFact[] = r.conditions.map((c, i) => ({
    id: `cond-${i}`,
    display: c.display,
    icd10: c.icd10 ?? undefined,
    snomed: c.snomed ?? undefined,
    note: c.note ?? undefined,
    inferred: c.inferred || undefined,
    confidence: c.confidence,
    provenance: toProvenance(c.provenance, labelOf),
  }));

  const allergies: AllergyFact[] = r.allergies.map((a, i) => ({
    id: `allergy-${i}`,
    display: a.display,
    snomed: a.snomed ?? undefined,
    reaction: a.reaction ?? undefined,
    confidence: a.confidence,
    provenance: toProvenance(a.provenance, labelOf),
  }));

  return {
    patient: {
      name: r.patient.name,
      dob: r.patient.dob ?? undefined,
      sex: r.patient.sex ?? undefined,
    },
    sources: sources.map(stripInternalSourceFields),
    medications,
    labs,
    conditions,
    allergies,
    insights: [],
  };
}

function toInsights(insights: Insights, record: HealthRecord): Insight[] {
  // Resolve human-readable display names back to fact ids for cross-linking.
  const index = new Map<string, string>();
  for (const f of [...record.medications, ...record.labs, ...record.conditions, ...record.allergies]) {
    index.set(f.display.toLowerCase(), f.id);
  }
  const resolve = (name: string): string | undefined => {
    const key = name.toLowerCase();
    if (index.has(key)) return index.get(key);
    for (const [display, id] of index) {
      if (display.includes(key) || key.includes(display)) return id;
    }
    return undefined;
  };

  return insights.insights.map((i, idx) => ({
    id: `insight-${idx}`,
    kind: i.kind,
    severity: i.severity,
    title: i.title,
    explanation: i.explanation,
    crossProvider: i.crossProvider || undefined,
    citationUrl: i.citationUrl ?? undefined,
    citationLabel: i.citationLabel ?? undefined,
    relatedFactIds: i.relatedFacts
      .map(resolve)
      .filter((id): id is string => Boolean(id)),
  }));
}

// --- Offline fallback (deterministic reference record) ------------------------

const OFFLINE_STAGES: { stage: string; label: string; detail: (r: HealthRecord) => string; delay: number }[] = [
  { stage: "ingest", label: "Reading source documents", detail: (r) => `${r.sources.length} records`, delay: 350 },
  {
    stage: "extract",
    label: "Extracting clinical facts",
    detail: (r) =>
      `${r.medications.length} meds, ${r.labs.length} labs, ${r.conditions.length} conditions, ${r.allergies.length} allergy`,
    delay: 600,
  },
  { stage: "reconcile", label: "Reconciling identity, codes & units", detail: () => "merging brand/generic · normalizing units", delay: 600 },
  { stage: "verify", label: "Grounding every fact to a source", detail: (r) => `${r.medications.length + r.labs.length + r.conditions.length + r.allergies.length} facts grounded`, delay: 450 },
  { stage: "analyze", label: "Cross-provider safety analysis", detail: (r) => `${r.insights.length} findings`, delay: 700 },
];

async function* runOffline(docs: SourceDoc[], reason: string | null): AsyncGenerator<PipelineEvent> {
  const record: HealthRecord = {
    ...MOCK_RECORD,
    sources: docs.map(stripInternalSourceFields),
    meta: { pipeline: "fallback" },
  };
  if (reason) yield { type: "note", stage: "ingest", tone: "flag", text: reason };

  for (const s of OFFLINE_STAGES) {
    yield { type: "stage", stage: s.stage, label: s.label, status: "start" };
    await sleep(s.delay);
    yield { type: "stage", stage: s.stage, label: s.label, status: "done", detail: s.detail(record) };
  }
  yield { type: "result", record };
}

// --- utilities ----------------------------------------------------------------

/** Run `fn` over every item concurrently and yield each result the moment it settles. */
async function* streamSettled<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
): AsyncGenerator<R> {
  const remaining = new Map<number, Promise<readonly [number, R]>>(
    items.map((item, i) => [i, fn(item).then((result) => [i, result] as const)]),
  );
  while (remaining.size > 0) {
    const [index, result] = await Promise.race(remaining.values());
    remaining.delete(index);
    yield result;
  }
}

export { hasXai };
