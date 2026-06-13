import { z } from "zod";

/**
 * Zod contracts for every Grok call. These are the single source of truth for
 * what the model must return — `generateObject` enforces them, so the rest of
 * the pipeline can trust the shape. We use `.nullable()` (not `.optional()`)
 * because structured output is more reliable when the model emits explicit
 * `null`s than when it omits keys.
 */

/** Raw, verbatim mentions extracted from ONE source document. No codes, no inference. */
export const ExtractionSchema = z.object({
  sourceSystem: z
    .string()
    .nullable()
    .describe("The facility/health system that produced this document, read from its header (e.g. 'Pacific Heart Cardiology', 'Bay Area Family Medicine', 'CVS Pharmacy #6648'). Null if not stated."),
  patient: z.object({
    name: z.string().nullable(),
    dob: z.string().nullable(),
    sex: z.string().nullable(),
    recordId: z.string().nullable(),
  }),
  medications: z.array(
    z.object({
      name: z.string().describe("Drug as written, including brand names (e.g. 'Zestril 10 mg')."),
      dose: z.string().nullable(),
      sig: z.string().nullable().describe("Directions, e.g. '1 tab PO BID'."),
      textSpan: z.string().describe("Exact verbatim substring this came from. Copy character-for-character."),
    }),
  ),
  labs: z.array(
    z.object({
      name: z.string(),
      value: z.string().nullable().describe("Keep as written, e.g. '52', '>60', '6.1'."),
      unit: z.string().nullable(),
      date: z.string().nullable().describe("ISO date if determinable, else null."),
      textSpan: z.string(),
    }),
  ),
  conditions: z.array(
    z.object({
      name: z.string(),
      code: z.string().nullable().describe("ICD-10/SNOMED if explicitly printed in the doc, else null."),
      textSpan: z.string(),
    }),
  ),
  allergies: z.array(
    z.object({
      substance: z.string(),
      reaction: z.string().nullable(),
      textSpan: z.string(),
    }),
  ),
});

export type Extraction = z.infer<typeof ExtractionSchema>;

const ProvenanceRef = z.object({
  sourceDocId: z.string().describe("The id of the source document this fact came from."),
  textSpan: z.string().describe("Exact quote from that document supporting this fact."),
});

/**
 * The unified, coded, de-duplicated record. This is the hard reasoning step:
 * one drug under brand+generic+NDC collapses to one entry; lab values in
 * different units are normalized into one series with a trend; identity is
 * resolved across name variants.
 */
export const ReconciledSchema = z.object({
  patient: z.object({
    name: z.string(),
    dob: z.string().nullable(),
    sex: z.string().nullable(),
  }),
  medications: z.array(
    z.object({
      display: z.string().describe("Canonical RxNorm-style name, e.g. 'Lisinopril 10 MG Oral Tablet'."),
      rxnorm: z.string().nullable(),
      dose: z.string().nullable(),
      sig: z.string().nullable(),
      status: z.enum(["active", "acute", "resolved"]),
      aliases: z.array(z.string()).describe("Every way this one drug appeared across sources."),
      reviewNeeded: z.boolean().describe("True if this merge could be a duplicate-therapy risk a clinician should confirm."),
      confidence: z.number().min(0).max(1),
      provenance: z.array(ProvenanceRef),
    }),
  ),
  labs: z.array(
    z.object({
      display: z.string(),
      loinc: z.string().nullable(),
      goal: z.string().nullable(),
      trend: z.enum(["rising", "falling", "stable"]).nullable(),
      confidence: z.number().min(0).max(1),
      series: z.array(
        z.object({
          date: z.string(),
          value: z.number().nullable().describe("Numeric value in the NORMALIZED unit; null if not numeric (e.g. '>60')."),
          unit: z.string(),
          reported: z.string().nullable().describe("Original value+unit if it was converted, e.g. '52 mmol/mol (IFCC)'."),
          normalizedValue: z.number().nullable(),
          source: z.string(),
        }),
      ),
      provenance: z.array(ProvenanceRef),
    }),
  ),
  conditions: z.array(
    z.object({
      display: z.string(),
      icd10: z.string().nullable(),
      snomed: z.string().nullable(),
      note: z.string().nullable(),
      inferred: z.boolean().describe("True if Concord inferred this (e.g. from a lab trend) and no provider coded it."),
      confidence: z.number().min(0).max(1),
      provenance: z.array(ProvenanceRef),
    }),
  ),
  allergies: z.array(
    z.object({
      display: z.string(),
      snomed: z.string().nullable(),
      reaction: z.string().nullable(),
      confidence: z.number().min(0).max(1),
      provenance: z.array(ProvenanceRef),
    }),
  ),
  identityNotes: z.array(z.string()).describe("Short human notes on patient-identity resolution across sources."),
  reconciliationNotes: z.array(z.string()).describe("Short human notes on each non-trivial merge/normalization performed."),
});

export type Reconciled = z.infer<typeof ReconciledSchema>;

/** Cross-provider clinical analysis over the reconciled record. */
export const InsightsSchema = z.object({
  insights: z.array(
    z.object({
      kind: z.enum(["interaction", "duplicate_therapy", "lab_trend", "care_gap", "question"]),
      severity: z.enum(["high", "medium", "low"]),
      title: z.string(),
      explanation: z.string().describe("Plain-English why-it-matters, 1-3 sentences."),
      crossProvider: z.boolean().describe("True if no single provider's record could have revealed this."),
      citationUrl: z.string().nullable(),
      citationLabel: z.string().nullable(),
      relatedFacts: z.array(z.string()).describe("Display names of the meds/labs/conditions this finding is about."),
    }),
  ),
});

export type Insights = z.infer<typeof InsightsSchema>;
