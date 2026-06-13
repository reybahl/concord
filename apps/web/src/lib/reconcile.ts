import { streamObject } from "ai";

import { grokModel } from "./grok";
import { ReconciledSchema, type Reconciled } from "./schemas";
import seedCodes from "./seed-codes.json";
import type { DocExtraction } from "./extract";

const SYSTEM = `You are Concord's reconciliation engine. You merge clinical facts that several different healthcare systems recorded about ONE patient into a single, coded, de-duplicated record. This is the step a human medication-reconciliation pharmacist does by hand.

Do all of the following:
1. IDENTITY: confirm the records describe one patient even when names/MRNs differ (e.g. "Gonzalez" vs "Gonzales"). Summarize how you matched them in identityNotes.
2. DE-DUPLICATE MEDICATIONS: collapse brand + generic + NDC mentions of the SAME drug into one entry (e.g. Lisinopril and Zestril are one drug). List every surface form in \`aliases\`. If two sources prescribed what is effectively the same therapy, set reviewNeeded=true and explain it in reconciliationNotes.
3. CODE: assign RxNorm to meds, LOINC to labs, ICD-10 + SNOMED to conditions, SNOMED to allergies. Prefer codes from the provided vocabulary; only use a code you are confident is correct, otherwise leave it null.
4. LABS — KEEP THEM ALL: emit EVERY distinct lab analyte as its own observation (e.g. HbA1c, LDL cholesterol, serum creatinine, eGFR, potassium, fasting glucose). Never collapse different analytes together and never drop labs. For each analyte, build one time-series with every reported point across sources/dates, and set the \`trend\`.
5. NORMALIZE UNITS: when the same lab is reported in different units across sources, convert to one canonical unit. Put the converted value in \`value\`/\`normalizedValue\` and keep the original in \`reported\` (e.g. HbA1c reported as IFCC mmol/mol must be converted to NGSP %).
6. INFER UNCODED CONDITIONS: if a lab trend implies a clinical condition that no provider has explicitly coded (e.g. eGFR declining into the 45-59 range implies CKD stage 3a), add it as a condition with inferred=true and a note explaining the basis. This is a key safety value of reconciliation.
7. GROUND EVERYTHING: every fact's \`provenance\` must reference the exact sourceDocId(s) and the verbatim textSpan it came from. Never invent a fact with no source.
8. CONFIDENCE: 0-1. Lower it when a value is ambiguous or only loosely supported.

Be precise and conservative. Do not hallucinate codes, values, or facts. Notes must be short (one line each) and specific.`;

export type ReconcileNoteTone = "info" | "merge" | "model";

export type ReconcileStreamEvent =
  | { type: "note"; text: string; tone: ReconcileNoteTone }
  | { type: "done"; result: Reconciled };

const HEARTBEATS = [
  "Matching patient identity across sources…",
  "Collapsing brand/generic duplicates…",
  "Assigning RxNorm / LOINC / SNOMED codes…",
  "Building lab time-series and normalizing units…",
  "Checking for uncoded conditions from lab trends…",
];

function vocabularyBlock(): string {
  return JSON.stringify(seedCodes, null, 0);
}

function extractionsBlock(docs: DocExtraction[]): string {
  return docs
    .map(({ doc, extraction }) =>
      JSON.stringify({
        sourceDocId: doc.id,
        label: doc.label,
        system: doc.system,
        date: doc.date ?? null,
        ...extraction,
      }),
    )
    .join("\n");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Race an async iterator against a periodic heartbeat so long model calls never look frozen. */
async function* withHeartbeat<T>(
  source: AsyncIterable<T>,
  intervalMs: number,
  heartbeat: () => ReconcileStreamEvent,
): AsyncGenerator<T | ReconcileStreamEvent> {
  const iterator = source[Symbol.asyncIterator]();
  let pending = iterator.next();

  while (true) {
    const result = await Promise.race([
      pending,
      sleep(intervalMs).then(() => null),
    ]);

    if (result === null) {
      yield heartbeat();
      continue;
    }

    if (result.done) return;
    yield result.value;
    pending = iterator.next();
  }
}

function* notesFromPartial(
  partial: {
    patient?: { name?: string };
    identityNotes?: (string | undefined)[];
    reconciliationNotes?: (string | undefined)[];
    medications?: unknown[];
    labs?: unknown[];
    conditions?: unknown[];
  },
  state: {
    lastIdentityCount: number;
    lastReconCount: number;
    lastMedCount: number;
    lastLabCount: number;
    lastCondCount: number;
    patientEmitted: boolean;
  },
): Generator<ReconcileStreamEvent> {
  if (partial.patient?.name && !state.patientEmitted) {
    state.patientEmitted = true;
    yield { type: "note", tone: "info", text: `Patient: ${partial.patient.name}` };
  }

  const identityNotes = partial.identityNotes ?? [];
  for (let i = state.lastIdentityCount; i < identityNotes.length; i++) {
    const text = identityNotes[i];
    if (text) yield { type: "note", tone: "info", text };
  }
  state.lastIdentityCount = identityNotes.length;

  const reconNotes = partial.reconciliationNotes ?? [];
  for (let i = state.lastReconCount; i < reconNotes.length; i++) {
    const text = reconNotes[i];
    if (text) yield { type: "note", tone: "merge", text };
  }
  state.lastReconCount = reconNotes.length;

  const medCount = partial.medications?.length ?? 0;
  if (medCount > state.lastMedCount) {
    yield { type: "note", tone: "model", text: `${medCount} medication${medCount === 1 ? "" : "s"} reconciled…` };
    state.lastMedCount = medCount;
  }

  const labCount = partial.labs?.length ?? 0;
  if (labCount > state.lastLabCount) {
    yield { type: "note", tone: "model", text: `${labCount} lab series built…` };
    state.lastLabCount = labCount;
  }

  const condCount = partial.conditions?.length ?? 0;
  if (condCount > state.lastCondCount) {
    yield { type: "note", tone: "model", text: `${condCount} condition${condCount === 1 ? "" : "s"} coded…` };
    state.lastCondCount = condCount;
  }
}

/** Stream reconciliation progress as Grok fills in the structured record. */
export async function* reconcileStream(docs: DocExtraction[]): AsyncGenerator<ReconcileStreamEvent> {
  let heartbeatIndex = 0;
  const state = {
    lastIdentityCount: 0,
    lastReconCount: 0,
    lastMedCount: 0,
    lastLabCount: 0,
    lastCondCount: 0,
    patientEmitted: false,
  };

  const { partialObjectStream, object } = streamObject({
    model: grokModel("reconcile"),
    schema: ReconciledSchema,
    temperature: 0,
    system: SYSTEM,
    prompt: [
      "Per-document extractions (one JSON object per line):",
      extractionsBlock(docs),
      "",
      "Authoritative coding vocabulary (RxNorm/LOINC/SNOMED/ICD-10 reference for the entities you will see). Use these codes when they match; otherwise leave the code null:",
      vocabularyBlock(),
    ].join("\n"),
  });

  for await (const item of withHeartbeat(partialObjectStream, 3500, () => {
    const text = HEARTBEATS[heartbeatIndex % HEARTBEATS.length]!;
    heartbeatIndex += 1;
    return { type: "note", tone: "model", text };
  })) {
    if ("type" in item) {
      yield item;
      continue;
    }

    for (const note of notesFromPartial(item, state)) {
      yield note;
    }
  }

  yield { type: "done", result: await object };
}

/** Merge, code, and normalize all per-document extractions into one record. */
export async function reconcile(docs: DocExtraction[]): Promise<Reconciled> {
  for await (const event of reconcileStream(docs)) {
    if (event.type === "done") return event.result;
  }
  throw new Error("Reconciliation produced no result.");
}
