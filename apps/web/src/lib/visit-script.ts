import type { HealthRecord } from "./types";

/**
 * Simulated visit demo — director notes per turn, wording generated live.
 *
 * Arc (4 quick rounds):
 *   greet → azithromycin switch (safe) → amoxicillin add (unsafe — allergy on record) → done
 *
 * Beat 1 never mentions penicillin or amoxicillin so beat 2 isn't self-contradictory.
 */

export interface VisitScript {
  doctorPersona: string;
  patientPersona: string;
  doctorBeats: string[];
  patientBeats: string[];
  doctorFree: string;
  patientFree: string;
}

export function buildVisitScript(record: HealthRecord): VisitScript {
  const name = record.patient.name || "the patient";
  const firstName = name.split(" ")[0] || name;

  const doctorPersona = `You are Dr. Alan Reyes, a warm primary-care physician seeing ${name}. Speak ALOUD in the first person, naturally, ONE to TWO sentences per turn — never more. Follow the private director note for each turn EXACTLY. NEVER read the note aloud, never mention being an AI or a script, and never say "Concord". Do NOT propose any medication, test, or order unless the director note explicitly requires it.`;

  const patientPersona = `You are ${name}, a 58-year-old woman at a doctor's visit. Speak ALOUD in the first person, ONE short sentence per turn. Follow the private director note but never read it aloud. Do NOT repeat drug names or doses back unless the note asks you to.`;

  const doctorBeats = [
    `Greet ${firstName} and ask briefly about her cough — how long and any fever. Do NOT prescribe anything yet.`,
    `Explain that urgent care started clarithromycin but she is on simvastatin — that combination is unsafe. Stop clarithromycin and prescribe azithromycin: 500 milligrams today, then 250 milligrams once daily for four days. Do NOT mention penicillin, amoxicillin, beta-lactams, imaging, or OTC meds.`,
    `[REQUIRED THIS TURN] You want broader coverage — ADD amoxicillin 500 milligrams three times a day for five days on top of the azithromycin. You MUST say the word amoxicillin and the dose. Do not mention allergies or prior antibiotic choices. Do not propose anything else.`,
    `Wrap up warmly in one sentence — tell ${firstName} to pick up the prescriptions. No new meds or tests.`,
  ];

  const patientBeats = [
    `Greet the doctor and say you've had a nagging cough for about a week with some congestion.`,
    `React trustingly in one short sentence. Do NOT name any drugs.`,
    `Agree briefly — you trust his judgment. Do NOT name any drugs.`,
    `Thank him and say you'll pick up the prescriptions.`,
  ];

  const doctorFree = `Give brief reassurance only. ONE short sentence. Do NOT propose any medications, tests, or orders.`;
  const patientFree = `Respond briefly with a short acknowledgement. ONE short sentence.`;

  return { doctorPersona, patientPersona, doctorBeats, patientBeats, doctorFree, patientFree };
}
