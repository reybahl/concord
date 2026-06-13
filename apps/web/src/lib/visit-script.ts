import type { HealthRecord } from "./types";

/**
 * The script for the simulated visit demo. The conversation is "mostly scripted"
 * via per-turn director notes (so it reliably walks into the Guardian's catches)
 * but the exact wording is generated live by each voice agent, so it sounds
 * natural and never identical twice. After the scripted beats run out, the
 * actors free-wheel on benign small talk so the visit can run indefinitely.
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

  const doctorPersona = `You are Dr. Alan Reyes, a warm, seasoned primary-care physician seeing your patient ${name} for a follow-up visit. Speak ALOUD in the first person, naturally and conversationally, ONE to TWO sentences per turn — never more. You are in the exam room. Follow the private director note for each turn but NEVER read the note aloud and never mention being an AI or a script. Never say the word "Concord".`;

  const patientPersona = `You are ${name}, a 58-year-old woman at a doctor's visit. You have type 2 diabetes, high blood pressure, high cholesterol, and a known penicillin allergy (it gives you a rash). You are warm, a little chatty, and trusting of your doctor. Speak ALOUD in the first person, ONE to TWO sentences per turn — never more. Follow the private director note for each turn but never read it aloud and never mention being an AI.`;

  // The doctor and patient are unaware of the Guardian — they never hear or
  // acknowledge its alerts. The doctor simply works through a plausible but
  // unsafe set of orders; the catches happen for the listener in the other tab.
  const doctorBeats = [
    `Greet ${firstName} warmly by her first name and ask how she has been feeling since her last visit.`,
    `Listen, then ask one brief follow-up about her symptoms — fever, the color of any phlegm, how long it's been going on.`,
    `Conclude she likely has a bacterial chest infection and tell her, clearly and specifically, that you're going to start her on amoxicillin 500 milligrams three times a day.`,
    `Move on confidently. Say that for her stubborn cough you also want to add clarithromycin 500 milligrams twice daily.`,
    `Keep going. Say that to be thorough you also want to order a CT scan of the chest WITH IV contrast.`,
    `Wrap up warmly: reassure ${firstName}, and mention her recent lab work shows a few things you're watching, like her A1c and kidney numbers. Ask if she has any questions.`,
  ];

  const patientBeats = [
    `Greet the doctor warmly and mention you've had a nagging cough and congestion for about a week that won't quit.`,
    `Answer his questions: yellowish phlegm, a low fever the last couple days, and you're pretty wiped out.`,
    `React simply and trustingly to whatever the doctor just said — you trust him completely and go along with the plan. Keep it to one short sentence.`,
    `React naturally and briefly; keep trusting the doctor's plan.`,
    `React naturally — you're a little nervous about a CT scan but you trust him. Keep it brief.`,
    `Turn to your phone's record assistant and ask it out loud, directly: "Concord, what medications am I currently taking?"`,
  ];

  const doctorFree = `Continue the visit naturally: give brief, friendly wellness guidance (diet, hydration, rest, when to follow up) or reassurance. Keep it to ONE short sentence. Do NOT propose any new medications, tests, or orders.`;
  const patientFree = `Respond naturally and briefly with a short question or an acknowledgement. Keep it to ONE short sentence.`;

  return { doctorPersona, patientPersona, doctorBeats, patientBeats, doctorFree, patientFree };
}
