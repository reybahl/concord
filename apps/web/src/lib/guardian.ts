import { generateObject, generateText, Output, stepCountIs } from "ai";
import { z } from "zod";

import { collectWebSearchUrls, filterReachableSources } from "./citations";
import { grokModel, grokResponsesModel, grokWebSearchTool } from "./grok";
import type { HealthRecord } from "./types";

/**
 * The Guardian is Concord's point-of-care safety layer. It listens to a live
 * clinical conversation and, when a clinician proposes a NEW medication or
 * diagnostic order, checks that action against the patient's reconciled,
 * cross-provider record — catching the conflict no single provider could see.
 */

export const GuardianVerdictSchema = z.object({
  conflict: z
    .boolean()
    .describe("True only if the proposed action is genuinely unsafe given this patient's reconciled record."),
  severity: z.enum(["high", "medium", "low", "none"]),
  category: z.enum([
    "interaction",
    "duplicate_therapy",
    "allergy",
    "renal_dosing",
    "contraindication",
    "none",
  ]),
  proposedAction: z.string().describe("The clinician's proposed action, normalized (e.g. 'Clarithromycin 500 mg BID x7d')."),
  spokenWarning: z
    .string()
    .describe(
      "What to say ALOUD in the exam room if there is a conflict — one or two urgent, plain-language sentences addressed to the clinician. Name the conflict, that it comes from another provider's record, and the safe alternative. Empty string if no conflict.",
    ),
  rationale: z.string().describe("A short clinical explanation for the on-screen card."),
  conflictingFacts: z
    .array(
      z.object({
        display: z.string().describe("The reconciled fact involved (e.g. 'Simvastatin 20 MG Oral Tablet')."),
        sourceLabel: z.string().describe("Which provider/source this fact came from."),
        textSpan: z.string().describe("The verbatim quote from that source document grounding this fact."),
      }),
    )
    .describe("The reconciled facts (with provenance) that make the proposed action unsafe. Empty if no conflict."),
  safeAlternative: z
    .string()
    .nullable()
    .describe("A concrete, safer alternative the clinician could choose (e.g. 'azithromycin, no CYP3A4 interaction'). Null if none."),
  unseenBy: z
    .string()
    .nullable()
    .describe("The provider/source that could NOT have known about this conflict, and why (e.g. 'Urgent Care — had no medication list'). Null if not applicable."),
  citationUrl: z.string().nullable(),
  citationLabel: z.string().nullable(),
});

export type GuardianVerdict = z.infer<typeof GuardianVerdictSchema>;

export type ProposedActionKind = "medication" | "diagnostic_order" | "other";

const ActionClassificationSchema = z.object({
  contains_clinical_action: z
    .boolean()
    .describe("True ONLY if a clinician is proposing/changing a medication, prescription, or dose, or ordering a diagnostic test."),
  action: z
    .string()
    .nullable()
    .describe("Normalized description of the proposed action (e.g. 'Clarithromycin 500 mg BID x7d'). Null if none."),
  kind: z.enum(["medication", "diagnostic_order", "other"]).nullable(),
});

export type ActionClassification = z.infer<typeof ActionClassificationSchema>;

const CLASSIFIER_SYSTEM = `You triage a single utterance overheard during a live medical visit. Decide ONLY whether it proposes a NEW clinical action that warrants a safety check.

Set contains_clinical_action=true ONLY when a SPECIFIC drug, dose, test, or procedure is named (e.g. "let's start you on clarithromycin", "I'll order a CT with contrast"). Put that named drug/test in "action".
Set it to false for greetings, small talk, symptom descriptions, history taking, reassurance, or anything that is not a new order/prescription.
Crucially, set it to false for unfinished or vague utterances where no specific drug or test is named yet (e.g. "I'm going to put you on", "let's start a", "we'll order some"). Wait for the concrete order — never guess.
Be precise — a false positive triggers an interruption in the exam room.`;

/**
 * Fast, cheap pre-filter run on every finalized room utterance. Only utterances
 * that actually propose a clinical action proceed to the expensive grounded
 * safety check, keeping the guardian silent and responsive.
 */
export async function classifyUtterance(utterance: string): Promise<ActionClassification> {
  const { object } = await generateObject({
    model: grokModel("extract"),
    schema: ActionClassificationSchema,
    temperature: 0,
    system: CLASSIFIER_SYSTEM,
    prompt: `Utterance overheard in the room: "${utterance}"`,
  });
  return object;
}

const SYSTEM = `You are Concord's clinical safety analyst. A clinician has just proposed a NEW action during a live visit. You must decide whether that action is unsafe GIVEN this specific patient's reconciled, cross-provider medication/lab/condition/allergy record.

This is the core value: the clinician in the room often does NOT have the full picture (e.g. an urgent-care doctor without the patient's med list). You do. Catch what they cannot see.

Evaluate the proposed action against the record for:
- interaction: a clinically significant drug-drug interaction with an ACTIVE medication (e.g. clarithromycin + simvastatin → rhabdomyolysis via CYP3A4). web_search the FDA label / official guidance for the citation.
- duplicate_therapy: the proposed drug duplicates an active drug or therapeutic class already present (including brand/generic of the same molecule).
- allergy: the proposed drug conflicts with a documented allergy (including cross-reactivity).
- renal_dosing / contraindication: the action is unsafe given a lab trend — e.g. ordering IV contrast or continuing metformin when eGFR is declining toward/into CKD G3a (contrast + metformin → lactic acidosis / AKI risk); a renally-cleared drug at full dose with reduced eGFR.

Rules:
- Set conflict=true ONLY for a genuine safety issue grounded in facts actually present in the record. If the action is fine, set conflict=false, severity="none", category="none", and leave spokenWarning empty.
- Ground every conflict: conflictingFacts MUST reference the real reconciled facts and their verbatim provenance quotes. Never invent a medication, lab, value, or quote.
- spokenWarning is delivered by text-to-speech into the room. Make it urgent but calm, ≤ 2 sentences, addressed to the clinician, and include the safe alternative.
- Reserve severity="high" for contraindicated / dangerous combinations.
- Leave citationUrl/citationLabel null unless web_search returned a real supporting source; never invent URLs.
- Be conservative and precise. A false alarm erodes trust as much as a miss.`;

/** Compact, grounded projection of the record for the safety reasoner. */
function recordDigest(record: HealthRecord): string {
  return JSON.stringify(
    {
      patient: record.patient,
      medications: record.medications.map((m) => ({
        display: m.display,
        rxnorm: m.rxnorm,
        status: m.status,
        sig: m.sig,
        aliases: m.aliases,
        provenance: m.provenance.map((p) => ({ source: p.sourceLabel, quote: p.textSpan })),
      })),
      labs: record.labs.map((l) => ({
        display: l.display,
        trend: l.trend,
        goal: l.goal,
        series: l.series.map((p) => ({ date: p.date, value: p.value, unit: p.unit })),
        provenance: l.provenance.map((p) => ({ source: p.sourceLabel, quote: p.textSpan })),
      })),
      conditions: record.conditions.map((c) => ({
        display: c.display,
        icd10: c.icd10,
        inferred: c.inferred,
        provenance: c.provenance.map((p) => ({ source: p.sourceLabel, quote: p.textSpan })),
      })),
      allergies: record.allergies.map((a) => ({
        display: a.display,
        reaction: a.reaction,
        provenance: a.provenance.map((p) => ({ source: p.sourceLabel, quote: p.textSpan })),
      })),
    },
    null,
    0,
  );
}

/** Check one proposed clinical action against the reconciled record. */
export async function checkClinicalAction(
  record: HealthRecord,
  action: string,
  kind: ProposedActionKind,
  quote?: string,
): Promise<GuardianVerdict> {
  const result = await generateText({
    model: grokResponsesModel("analyze"),
    tools: { web_search: grokWebSearchTool() },
    stopWhen: stepCountIs(6),
    output: Output.object({
      schema: GuardianVerdictSchema,
      name: "GuardianVerdict",
      description: "Point-of-care safety verdict for one proposed clinical action",
    }),
    temperature: 0,
    system: SYSTEM,
    prompt: [
      "Reconciled patient record:",
      recordDigest(record),
      "",
      `Proposed action (kind: ${kind}): ${action}`,
      quote ? `Heard in the room: "${quote}"` : null,
    ]
      .filter((line) => line !== null)
      .join("\n"),
  });

  if (!result.output) throw new Error("Guardian check produced no structured output.");
  const verdict = result.output;

  if (!verdict.conflict) {
    return { ...verdict, citationUrl: null, citationLabel: null };
  }

  const sources = collectWebSearchUrls(
    result.steps.flatMap((step) => step.toolResults),
    result.sources,
  );
  const reachable = await filterReachableSources(sources);
  const reachableUrls = new Set(reachable.map((s) => s.url));

  if (verdict.citationUrl && reachableUrls.has(verdict.citationUrl)) {
    return verdict;
  }

  const fda = reachable.find((s) => s.url.includes("fda.gov") || s.url.includes("accessdata.fda.gov"));
  const best = fda ?? reachable[0];
  if (best) {
    return { ...verdict, citationUrl: best.url, citationLabel: best.title?.trim() || "FDA reference" };
  }

  return { ...verdict, citationUrl: null, citationLabel: null };
}

/** Human-readable record summary embedded in the voice agent's system prompt. */
function recordSummaryForVoice(record: HealthRecord): string {
  const meds = record.medications
    .map((m) => `${m.display}${m.status === "acute" ? " (acute)" : ""}`)
    .join("; ");
  const allergies = record.allergies.map((a) => `${a.display}${a.reaction ? ` (${a.reaction})` : ""}`).join("; ");
  const conditions = record.conditions.map((c) => c.display).join("; ");
  const trends = record.labs
    .filter((l) => l.trend && l.trend !== "stable")
    .map((l) => `${l.display} ${l.trend}`)
    .join("; ");

  return [
    `Patient: ${record.patient.name}${record.patient.dob ? `, DOB ${record.patient.dob}` : ""}.`,
    `Active medications: ${meds || "none on file"}.`,
    `Allergies: ${allergies || "none documented"}.`,
    `Conditions: ${conditions || "none documented"}.`,
    trends ? `Notable lab trends: ${trends}.` : null,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/**
 * System instructions for the realtime voice agent.
 *
 * The agent never auto-responds (the client uses `turn_detection: null`). It
 * only ever produces audio when the client explicitly asks it to — to answer a
 * direct question from the patient. Conflict warnings are delivered verbatim
 * via `force_message`, so they do not depend on these instructions.
 */
export function guardianInstructions(record: HealthRecord): string {
  return `You are Concord — a clinical safety guardian carried by the patient, silently listening to a live medical visit. You hold the patient's reconciled, cross-provider health record:

${recordSummaryForVoice(record)}

You are SILENT by default and you are NOT a chatbot. Never greet, never narrate, never volunteer information.`;
}

/** Direct address ("Concord, ...") — the only thing that lets the guardian answer freely. */
export const GUARDIAN_NAME_PATTERN = /\bconcord\b/i;

/**
 * Produce a short, grounded spoken answer when the patient addresses the
 * guardian directly. The answer is generated server-side from the reconciled
 * record (not by the realtime model) so it stays factual and on-record.
 */
export async function answerFromRecord(record: HealthRecord, question: string): Promise<string> {
  const { text } = await generateText({
    model: grokModel("extract"),
    temperature: 0.2,
    system: `You are Concord, the patient's health record speaking aloud at the point of care. Answer the patient's question in ONE or TWO short, calm spoken sentences, using ONLY the reconciled record below. If the answer is not in the record, say you don't have that on file. Do not greet or add commentary.

${recordSummaryForVoice(record)}`,
    prompt: question,
  });
  return text.trim();
}

/** Turn a finished visit transcript into a clinical note that re-enters the pipeline (Learn). */
export function transcriptToVisitNote(
  turns: { role: "room" | "guardian"; text: string }[],
  capturedAt = new Date(),
): string {
  const lines = turns
    .filter((t) => t.text.trim())
    .map((t) => `${t.role === "room" ? "Clinician/Patient" : "Concord Guardian"}: ${t.text.trim()}`);

  return [
    "CONCORD GUARDIAN — VISIT TRANSCRIPT",
    `Captured: ${capturedAt.toISOString()}`,
    "Source system: Concord Guardian (live visit capture, patient-owned)",
    "------------------------------------------------------------",
    ...lines,
  ].join("\n");
}
