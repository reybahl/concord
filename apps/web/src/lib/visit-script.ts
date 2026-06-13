import type { HealthRecord } from "./types";

/**
 * The script for the simulated visit demo. The conversation is "mostly scripted"
 * via per-turn director notes but the exact wording is generated live by each
 * voice agent, so it sounds natural and never identical twice.
 *
 * The arc walks through record-aware safe orders first (Guardian logs green
 * checks), then a plausible unsafe order (Guardian speaks up) — one demo,
 * both behaviors.
 */

export interface VisitScript {
  doctorPersona: string;
  patientPersona: string;
  /** Director note for the doctor on round i. */
  doctorBeats: string[];
  /** Director note for the patient on round i. */
  patientBeats: string[];
  doctorFree: string;
  patientFree: string;
}

export function buildVisitScript(record: HealthRecord): VisitScript {
  const name = record.patient.name || "the patient";
  const firstName = name.split(" ")[0] || name;

  const doctorPersona = `You are Dr. Alan Reyes, a warm, seasoned primary-care physician seeing your patient ${name} for a follow-up visit. Speak ALOUD in the first person, naturally and conversationally, ONE to TWO sentences per turn — never more. You are in the exam room. Follow the private director note for each turn EXACTLY — if the note says to order a test or prescribe a drug, you MUST do it this turn. NEVER read the note aloud, never mention being an AI or a script, and never say "Concord". Do not wrap up the visit until the director note tells you to.`;

  const patientPersona = `You are ${name}, a 58-year-old woman at a doctor's visit. You have type 2 diabetes, high blood pressure, high cholesterol, and a known penicillin allergy (it gives you a rash). You are warm, a little chatty, and trusting of your doctor. Speak ALOUD in the first person, ONE to TWO sentences per turn — never more. Follow the private director note for each turn but never read it aloud and never mention being an AI. When reacting to the doctor's plan, agree briefly — do NOT repeat drug names or doses back unless the note asks you to address Concord.`;

  const doctorBeats = [
    `Greet ${firstName} warmly by her first name and ask how she has been feeling since her last visit.`,
    `Listen, then ask one brief follow-up about her symptoms — fever, the color of any phlegm, how long it's been going on.`,
    // Safe — record-aware antibiotic switch (should clear).
    `Say urgent care started clarithromycin but she is on simvastatin — that combination is unsafe. Stop clarithromycin and prescribe azithromycin: 500 milligrams today, then 250 milligrams once daily for four days. Mention her penicillin allergy as a reason to avoid beta-lactams. Do NOT prescribe amoxicillin yet. Do NOT order imaging yet. Do NOT wrap up the visit.`,
    // Safe — kidney-aware imaging (should clear).
    `[REQUIRED THIS TURN] Order a plain chest X-ray with absolutely NO IV contrast to rule out pneumonia, citing her rising creatinine and falling eGFR. Say nothing about antibiotics or wrapping up.`,
    // Unsafe — penicillin allergy (Guardian should catch and speak up).
    `[REQUIRED THIS TURN] Change course: tell her you want to ADD amoxicillin 500 milligrams three times a day for five days on top of everything else for extra coverage. You MUST say the word amoxicillin and the dose. Do not say you are avoiding amoxicillin.`,
    `Wrap up warmly: reassure ${firstName}, mention her A1c and kidney numbers you're watching, and ask if she has any questions. Do not propose any new medications or tests.`,
  ];

  const patientBeats = [
    `Greet the doctor warmly and mention you've had a nagging cough and congestion for about a week that won't quit.`,
    `Answer his questions: yellowish phlegm, a low fever the last couple days, and you're pretty wiped out.`,
    `React simply and trustingly to whatever the doctor just said — you trust him completely. Do NOT repeat drug names or doses.`,
    `React naturally and briefly to the imaging plan; keep trusting the doctor.`,
    `React trustingly to the new antibiotic plan — you assume he knows best. Keep it brief. Do NOT name any drugs.`,
    `Turn to your phone's record assistant and ask it out loud, directly: "Concord, what medications am I currently taking?"`,
  ];

  const doctorFree = `Continue the visit naturally: give brief, friendly wellness guidance (diet, hydration, rest, when to follow up) or reassurance. Keep it to ONE short sentence. Do NOT propose any new medications, tests, or orders.`;
  const patientFree = `Respond naturally and briefly with a short question or an acknowledgement. Keep it to ONE short sentence.`;

  return { doctorPersona, patientPersona, doctorBeats, patientBeats, doctorFree, patientFree };
}
