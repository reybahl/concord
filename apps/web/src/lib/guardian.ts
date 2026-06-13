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
    .describe("True ONLY if a clinician is newly ordering, starting, continuing, or changing a medication/dose, or ordering a diagnostic test."),
  action: z
    .string()
    .nullable()
    .describe("Internal normalized action for safety reasoning. Null if none."),
  displayLabel: z
    .string()
    .nullable()
    .describe(
      "Concise card title (≤12 words) for the UI, e.g. 'Azithromycin 500 mg × 5 days', 'Discontinue clarithromycin', 'Plain chest X-ray (no contrast)'. Null if none.",
    ),
  dedupKey: z
    .string()
    .nullable()
    .describe(
      "Stable dedup id: med:start:azithromycin, med:stop:clarithromycin, img:chest-xray-plain. Same decision = same key regardless of label wording.",
    ),
  kind: z.enum(["medication", "diagnostic_order", "other"]).nullable(),
  intent: z
    .enum(["start", "continue", "stop", "order", "other"])
    .nullable()
    .describe("start/continue/order = new or ongoing therapy/test; stop = discontinuing; other = unclear."),
});

export type ActionClassification = z.infer<typeof ActionClassificationSchema>;

const CLASSIFIER_SYSTEM = `You triage a single utterance overheard during a live medical visit. Decide ONLY whether a CLINICIAN proposes a NEW clinical action that warrants a safety check.

Set contains_clinical_action=true ONLY when the clinician is NEWLY ordering, starting, CONTINUING, or changing a medication/dose, or ordering a diagnostic test.

Set contains_clinical_action=false when:
- the PATIENT is agreeing, repeating, or confirming a plan ("I'm happy to stop…", "I'll start that today", "That makes sense", "I trust your judgment")
- only explaining why a drug is unsafe or mentioning a drug the patient is already on without a new order
- greetings, symptoms, history, reassurance, or wrap-up with no new order
- unfinished fragments with no specific drug/test named yet
- vague orders with no named drug or test (e.g. "send a prescription", "order a medication")

When switching from drug A to drug B, assess ONLY drug B as a new start. Never assess stopping A unless the clinician's ONLY action this utterance is discontinuing with no new prescription in the same breath.

If the clinician is discontinuing a drug, set intent "stop", action "stop <drug>", displayLabel "Discontinue <drug>", kind "medication", contains_clinical_action=true.

displayLabel rules (always set when contains_clinical_action=true):
- New Rx: drug + dose + schedule in clinical shorthand, e.g. "Azithromycin 500 mg × 5 days", "Amoxicillin 500 mg TID × 5 days"
- Stop: "Discontinue clarithromycin" — name the drug being STOPPED, never the replacement drug
- Imaging: "Plain chest X-ray (no contrast)"
- dedupKey: med:start:<drug>, med:stop:<drug>, img:chest-xray-plain (lowercase drug name)
- Never use "stop Azithromycin" when the patient or clinician is stopping clarithromycin to switch to azithromycin

Examples:
- Clinician: "stop clarithromycin and switch to azithromycin 500 mg today then 250 mg daily" → action: azithromycin Rx, displayLabel: "Azithromycin 500 mg × 5 days", intent: start
- Clinician: "we'll stop the clarithromycin right away" → displayLabel: "Discontinue clarithromycin", intent: stop
- Patient: "I'm happy to stop clarithromycin and start azithromycin" → contains_clinical_action: false
- Clinician: "I'll order a plain chest X-ray, no IV contrast" → displayLabel: "Plain chest X-ray (no contrast)", intent: order
- Clinician: "add amoxicillin 500 mg three times a day" → displayLabel: "Amoxicillin 500 mg TID × 5 days", intent: start

Be precise — a false positive interrupts the exam room.`;

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
  return refineClassification(utterance, object);
}

const STOP_VERB =
  /\b(stop|stopping|discontinue|hold|avoid|not safe to continue|isn't safe to continue|won't continue|have you stop|switch off|switching off)\b/i;
const START_VERB = /\b(start|starting|prescribe|prescribing|put you on|continue|order|add|switch to|switching to|i'm adding)\b/i;
const PATIENT_ECHO =
  /\b(i'm happy to|i'll stop|i'll start|that makes (perfect )?sense|i trust|thank you doctor|thanks again|i'll pick up|i'll watch|feel better soon|you're welcome)\b/i;
const CLINICIAN_ORDER =
  /\b(i'm prescribing|i'll prescribe|let me order|i'm ordering|we'll order|i'm adding|i want to add|change course|instead,? i)\b/i;

/**
 * Safety net when the classifier treats "stop clarithromycin and switch to
 * azithromycin" as a clarithromycin prescription. Prefer the new drug or a
 * stop intent over a false start.
 */
export function refineClassification(utterance: string, c: ActionClassification): ActionClassification {
  if (PATIENT_ECHO.test(utterance) && !CLINICIAN_ORDER.test(utterance)) {
    return { contains_clinical_action: false, action: null, displayLabel: null, dedupKey: null, kind: null, intent: null };
  }

  if (!c.contains_clinical_action || !c.action) return c;

  const action = c.action.trim();
  const actionDrug = action.split(/\s+/)[0]?.toLowerCase() ?? "";
  const u = utterance.toLowerCase();

  if (c.intent === "stop" || /^(stop|discontinue|hold)\b/i.test(action)) {
    const drug = action.replace(/^(stop|discontinue|hold)\s+/i, "").split(/\s+/)[0] ?? action;
    return stampDedupKey({
      ...c,
      intent: "stop",
      kind: c.kind ?? "medication",
      displayLabel: c.displayLabel ?? `Discontinue ${drug}`,
    });
  }

  if (!actionDrug || actionDrug.length < 4) return c;

  const mentionsActionDrug = u.includes(actionDrug);
  const utteranceStopping = STOP_VERB.test(utterance) && mentionsActionDrug;
  const looksLikePrescription = /\b(mg|mcg|bid|tid|q\d|daily|x\d)\b/i.test(action);

  // Clinician is stopping this drug but classifier returned a prescription for it
  // (e.g. "urgent care started clarithromycin… I'm stopping the clarithromycin").
  if (utteranceStopping && mentionsActionDrug) {
    if (looksLikePrescription) {
      const switchTo = utterance.match(/\bswitch(?:ing)? to ([a-z]+(?:mycin|cycline|cillin|prazole|sartan|statin)?)/i);
      if (switchTo && switchTo[1].toLowerCase() !== actionDrug) {
        const newDrug = switchTo[1];
        const after = utterance.slice(utterance.toLowerCase().indexOf(newDrug.toLowerCase())).trim();
        const doseBit = after.split(/[.!?]/)[0]?.trim();
        const rxAction = doseBit.length > newDrug.length ? doseBit : `${newDrug} (new prescription)`;
        return stampDedupKey({
          contains_clinical_action: true,
          action: rxAction,
          displayLabel: c.displayLabel ?? rxAction,
          dedupKey: null,
          kind: "medication",
          intent: "start",
        });
      }
    }
    const stopped = action.split(/\s+/)[0] ?? action;
    return stampDedupKey({
      contains_clinical_action: true,
      action: `stop ${stopped}`,
      displayLabel: `Discontinue ${stopped}`,
      dedupKey: null,
      kind: "medication",
      intent: "stop",
    });
  }

  // Patient echoing "I'll stop clarithromycin" — not a new order from clinician
  if (utteranceStopping && !START_VERB.test(utterance) && c.intent !== "start") {
    return { contains_clinical_action: false, action: null, displayLabel: null, dedupKey: null, kind: null, intent: null };
  }

  return stampDedupKey({ ...c, displayLabel: c.displayLabel?.trim() || action });
}

const DRUG_NAMES =
  /\b(azithromycin|clarithromycin|amoxicillin|simvastatin|metformin|lisinopril|penicillin)\b/i;

function stampDedupKey(c: ActionClassification): ActionClassification {
  if (c.dedupKey?.trim()) return c;
  const label = (c.displayLabel ?? c.action ?? "").trim();
  if (!label) return c;

  const drug = label.match(DRUG_NAMES)?.[1]?.toLowerCase();
  if (drug) {
    const stopping =
      c.intent === "stop" || /^(stop|discontinue|hold)\b/i.test(c.action ?? "") || /^discontinue\b/i.test(label);
    return { ...c, dedupKey: stopping ? `med:stop:${drug}` : `med:start:${drug}` };
  }
  if (/x-?ray|chest radiograph|radiograph/.test(label.toLowerCase())) {
    return { ...c, dedupKey: "img:chest-xray-plain" };
  }
  return { ...c, dedupKey: normalizeActionKey(label) };
}

/** Card title used for dedup and display — falls back to action if the model omitted displayLabel. */
export function assessmentLabel(c: ActionClassification): string {
  return (c.displayLabel ?? c.action ?? "").trim();
}

/** Stable key — same clinical decision always maps to the same key. */
export function actionDedupKey(c: ActionClassification): string {
  return (c.dedupKey ?? normalizeActionKey(assessmentLabel(c))).trim().toLowerCase();
}

function clearVerdict(label: string, rationale: string): GuardianVerdict {
  return {
    conflict: false,
    severity: "none",
    category: "none",
    proposedAction: label,
    spokenWarning: "",
    rationale,
    conflictingFacts: [],
    safeAlternative: null,
    unseenBy: null,
    citationUrl: null,
    citationLabel: null,
  };
}

const DuplicateCheckSchema = z.object({
  duplicate: z
    .boolean()
    .describe("True if the new action is the same clinical decision as any item already assessed."),
});

/** Normalize for cheap exact/near-exact dedup. */
function normalizeActionKey(action: string): string {
  return action
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bdiscontinue\b/g, "stop")
    .replace(/\b(plain|without|no)\s+iv\s+contrast\b/g, "plain")
    .replace(/\bx-?ray\b/g, "xray")
    .replace(/\s+/g, " ")
    .trim();
}

function heuristicDuplicate(action: string, priorActions: string[]): boolean {
  const key = normalizeActionKey(action);
  if (!key) return false;
  if (priorActions.some((p) => normalizeActionKey(p) === key)) return true;

  const isStop = /^stop\b|^discontinue\b/.test(key);
  const drug = key.match(/\b(azithromycin|clarithromycin|amoxicillin|simvastatin|metformin|lisinopril)\b/)?.[1];
  if (drug) {
    for (const prior of priorActions) {
      const pk = normalizeActionKey(prior);
      if (!pk.includes(drug)) continue;
      if (isStop && (/^stop\b/.test(pk) || prior.toLowerCase().includes("discontinue"))) return true;
      if (!isStop && !/^stop\b/.test(pk) && !prior.toLowerCase().includes("discontinue") && pk.includes(drug))
        return true;
    }
    // Same drug, any start-variant label (partial ASR vs full dose).
    if (!isStop) {
      const startKey = `med:start:${drug}`;
      if (priorActions.some((p) => p.toLowerCase() === startKey || normalizeActionKey(p).includes(drug))) return true;
    }
  }

  if (/\bxray\b|x-?ray|chest radiograph/.test(key)) {
    if (priorActions.some((p) => /\bxray\b|x-?ray|chest radiograph/.test(normalizeActionKey(p)))) return true;
  }

  return false;
}

/**
 * Skip re-checking the same clinical decision when ASR repeats or rephrases it.
 * Fast heuristics first; LLM only when those don't match.
 */
export async function isDuplicateAssessment(
  action: string,
  priorActions: string[],
  dedupKey?: string,
  priorDedupKeys: string[] = [],
): Promise<boolean> {
  const key = dedupKey?.trim().toLowerCase();
  if (key && priorDedupKeys.some((k) => k.toLowerCase() === key)) return true;
  if (priorActions.length === 0 && priorDedupKeys.length === 0) return false;
  if (heuristicDuplicate(action, priorActions)) return true;
  if (key?.startsWith("med:start:")) {
    const drug = key.slice("med:start:".length);
    if (priorDedupKeys.some((k) => k === key || k === `med:start:${drug}`)) return true;
    if (priorActions.some((p) => p.toLowerCase().includes(drug))) return true;
  }
  if (key?.startsWith("med:stop:")) {
    if (priorDedupKeys.some((k) => k === key)) return true;
  }
  if (key === "img:chest-xray-plain") {
    if (priorDedupKeys.includes(key)) return true;
  }

  const { object } = await generateObject({
    model: grokModel("extract"),
    schema: DuplicateCheckSchema,
    temperature: 0,
    system: `Decide if a newly proposed clinical action is the SAME decision already assessed in this visit.
- Same drug order with different wording or dose detail = duplicate (e.g. "Azithromycin" vs "Azithromycin 500 mg day 1…").
- Plain chest X-ray variants = duplicate.
- "stop clarithromycin" twice = duplicate.
- Different drugs or a stop vs a new start of a different drug = NOT duplicate.
- Vague "prescription unspecified" vs a named drug = NOT duplicate unless clearly the same.`,
    prompt: [`New action: "${action}"`, "", "Already assessed:", ...priorActions.map((a, i) => `${i + 1}. ${a}`)].join(
      "\n",
    ),
  });
  return object.duplicate;
}

const SYSTEM = `You are Concord's clinical safety analyst. A clinician has just proposed a NEW action during a live visit. You must decide whether that action is unsafe GIVEN this specific patient's reconciled, cross-provider medication/lab/condition/allergy record.

This is the core value: the clinician in the room often does NOT have the full picture (e.g. an urgent-care doctor without the patient's med list). You do. Catch what they cannot see.

Evaluate the proposed action against the record for:
- interaction: a clinically significant drug-drug interaction with an ACTIVE medication (e.g. clarithromycin + simvastatin → rhabdomyolysis via CYP3A4).
- duplicate_therapy: the proposed drug would be ACTIVE CONCURRENTLY with the same drug/class already on the record. NOT duplicate if the clinician is REPLACING or SWITCHING (stopping the old drug in the same visit/turn — e.g. stop clarithromycin → start azithromycin). Two macrolides only conflict if both would be taken together.
- allergy: the proposed drug conflicts with a documented allergy (including cross-reactivity).
- renal_dosing / contraindication: the action is unsafe given a lab trend — e.g. ordering IV contrast or continuing metformin when eGFR is declining toward/into CKD G3a (contrast + metformin → lactic acidosis / AKI risk); a renally-cleared drug at full dose with reduced eGFR.

Rules:
- Set conflict=true ONLY for a genuine safety issue grounded in facts actually present in the record. If the action is fine, set conflict=false, severity="none", category="none", and leave spokenWarning empty.
- If the proposed action is STOPPING, DISCONTINUING, or HOLDING a medication (including "stop clarithromycin"), that is never a conflict — the clinician is removing a problem. Set conflict=false.
- If turn context shows the clinician is stopping/replacing drug A while starting drug B, do NOT flag B as duplicate_therapy with A.
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
  displayLabel: string,
  quote?: string,
  turnContext?: string,
): Promise<GuardianVerdict> {
  const normalized = action.trim();
  const label = displayLabel.trim() || normalized;
  if (/^(stop|discontinue|hold)\b/i.test(normalized) || /^discontinue\b/i.test(label)) {
    return clearVerdict(label, "No safety conflict identified with discontinuing the medication.");
  }

  // Fast path: reason over the record without web_search. Most clears finish here.
  const { object: verdict } = await generateObject({
    model: grokModel("analyze"),
    schema: GuardianVerdictSchema,
    temperature: 0,
    system: `${SYSTEM}\n\nSet proposedAction to exactly: "${label}" — do not rephrase it.`,
    prompt: [
      "Reconciled patient record:",
      recordDigest(record),
      "",
      `Proposed action (kind: ${kind}): ${action}`,
      `Card label (use verbatim for proposedAction): ${label}`,
      turnContext ? `Full turn context (same speaker turn): "${turnContext}"` : null,
      quote ? `Sentence assessed: "${quote}"` : null,
    ]
      .filter((line) => line !== null)
      .join("\n"),
  });

  const stamped = { ...verdict, proposedAction: label };
  if (!stamped.conflict) {
    return { ...stamped, citationUrl: null, citationLabel: null };
  }

  // Conflicts only: pull an FDA / clinical citation via web_search.
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
    system: `${SYSTEM}\n\nA preliminary review flagged a possible conflict. Use web_search to verify and attach an authoritative citation (FDA label preferred).\n\nSet proposedAction to exactly: "${label}" — do not rephrase it.`,
    prompt: [
      "Reconciled patient record:",
      recordDigest(record),
      "",
      `Proposed action (kind: ${kind}): ${action}`,
      `Card label (use verbatim for proposedAction): ${label}`,
      turnContext ? `Full turn context (same speaker turn): "${turnContext}"` : null,
      quote ? `Sentence assessed: "${quote}"` : null,
      "",
      "Preliminary rationale:",
      stamped.rationale,
    ]
      .filter((line) => line !== null)
      .join("\n"),
  });

  if (!result.output) return { ...stamped, citationUrl: null, citationLabel: null };
  const cited = { ...result.output, proposedAction: label };

  const sources = collectWebSearchUrls(
    result.steps.flatMap((step) => step.toolResults),
    result.sources,
  );
  const reachable = await filterReachableSources(sources);
  const reachableUrls = new Set(reachable.map((s) => s.url));

  if (cited.citationUrl && reachableUrls.has(cited.citationUrl)) {
    return cited;
  }

  const fda = reachable.find((s) => s.url.includes("fda.gov") || s.url.includes("accessdata.fda.gov"));
  const best = fda ?? reachable[0];
  if (best) {
    return { ...cited, citationUrl: best.url, citationLabel: best.title?.trim() || "FDA reference" };
  }

  return { ...cited, proposedAction: label, citationUrl: null, citationLabel: null };
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
