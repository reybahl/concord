import { generateObject } from "ai";

import { grokModel } from "./grok";
import { InsightsSchema, type Insights, type Reconciled } from "./schemas";

const SYSTEM = `You are Concord's cross-provider safety analyst. You read ONE reconciled, de-duplicated patient record assembled from multiple healthcare systems and surface clinically meaningful findings that no single provider — each seeing only their own slice — could have caught.

Produce findings of these kinds:
- interaction: a clinically significant drug-drug interaction between active medications (cite the mechanism).
- duplicate_therapy: the same drug/therapeutic class arriving from more than one provider. IMPORTANT: any medication with reviewNeeded=true was merged from brand + generic names prescribed by different providers (e.g. Lisinopril from the PCP and Zestril from cardiology) — surface this explicitly as a duplicate_therapy finding so the user sees the duplicate was caught, even though it is now reconciled into one entry. crossProvider=true.
- lab_trend: a meaningful trajectory in a lab series (e.g. HbA1c rising past goal). ALWAYS include a finding when kidney function is declining — i.e. eGFR falling toward/into the 45-59 range and/or serum creatinine rising — and explain why it matters for this patient's specific medications (e.g. metformin accumulation risk, ACE inhibitor + thiazide + potassium balance). crossProvider=true, since the labs proving the decline come from a different source than the prescribers.
- care_gap: a guideline-recommended action that appears to be missing OR a treatment that is not achieving its goal. ALWAYS flag a lab that remains above goal despite an on-label medication for it (e.g. LDL cholesterol above the <100 mg/dL goal while the patient is on a statin like simvastatin -> statin not at goal). crossProvider=true when the prescriber and the lab proving it isn't working are different providers.
- question: a concrete, plain-language question the patient should ask at their next visit.

Rules:
- Ground every finding in facts that are actually present in the record. Reference them by their display name in \`relatedFacts\`. Do NOT invent medications, labs, or values.
- Set crossProvider=true when the finding only becomes visible after combining sources.
- Rank by severity honestly. Reserve "high" for genuine safety issues (e.g. a contraindicated combination, an interaction with an active acute med).
- When you cite guidance (e.g. an FDA label or a clinical guideline), put a real, well-known URL in citationUrl and a short citationLabel; if you are not confident the URL is correct, set both to null rather than guessing.
- explanation must be plain English a non-clinician can understand, 1-3 sentences.
- Be concise. Quality over quantity — a few sharp, correct findings beat a long noisy list.`;

/** Compact projection of the record so the analyst sees facts without provenance noise. */
function recordDigest(r: Reconciled): string {
  return JSON.stringify(
    {
      patient: r.patient,
      medications: r.medications.map((m) => ({
        display: m.display,
        rxnorm: m.rxnorm,
        status: m.status,
        sig: m.sig,
        aliases: m.aliases,
        reviewNeeded: m.reviewNeeded,
      })),
      labs: r.labs.map((l) => ({
        display: l.display,
        loinc: l.loinc,
        goal: l.goal,
        trend: l.trend,
        series: l.series.map((p) => ({ date: p.date, value: p.value, unit: p.unit })),
      })),
      conditions: r.conditions.map((c) => ({ display: c.display, icd10: c.icd10 })),
      allergies: r.allergies.map((a) => ({ display: a.display, reaction: a.reaction })),
    },
    null,
    0,
  );
}

/** Run the cross-provider safety analysis over a reconciled record. */
export async function analyze(record: Reconciled): Promise<Insights> {
  const { object } = await generateObject({
    model: grokModel("analyze"),
    schema: InsightsSchema,
    temperature: 0.2,
    system: SYSTEM,
    prompt: ["Reconciled patient record:", recordDigest(record)].join("\n"),
  });

  return object;
}
