import { generateObject } from "ai";

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

/** Trim the seed vocabulary to the fields useful for coding, to keep the prompt tight. */
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

/** Merge, code, and normalize all per-document extractions into one record. */
export async function reconcile(docs: DocExtraction[]): Promise<Reconciled> {
  const { object } = await generateObject({
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

  return object;
}
