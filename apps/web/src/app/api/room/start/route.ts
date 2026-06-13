import { isStorageConfigured } from "@/lib/documents";
import { apiError, apiOk } from "@/lib/api";
import { getLatestRecordForSession } from "@/lib/reconciled-records";
import { getOrCreateSessionId, getSessionId } from "@/lib/session";
import { buildVisitScript } from "@/lib/visit-script";
import { hasVoice, mintRealtimeToken, VOICE_MODEL } from "@/lib/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Distinct built-in voices so the doctor and patient are clearly different
// people in the room (and both different from the Guardian's voice).
const DOCTOR_VOICE = "rex";
const PATIENT_VOICE = "eve";

/**
 * Boot the standalone exam-room demo: mint an ephemeral token for the doctor
 * and the patient and return their personas + beat script. The room runs the
 * conversation aloud; there is intentionally no Guardian here. The Guardian
 * runs in a separate tab and hears this through the microphone.
 */
export async function POST() {
  if (!hasVoice()) return apiError("Voice is not configured (XAI_API_KEY required).", 503);
  if (!isStorageConfigured()) return apiError("Storage is not configured.", 503);

  try {
    const sessionId = (await getSessionId()) ?? (await getOrCreateSessionId());
    const saved = await getLatestRecordForSession(sessionId);
    if (!saved) {
      return apiError("Reconcile a health record first — the demo needs it to know what's unsafe.", 400);
    }

    const script = buildVisitScript(saved.record);
    const [doctorToken, patientToken] = await Promise.all([mintRealtimeToken(900), mintRealtimeToken(900)]);

    return apiOk({
      model: VOICE_MODEL,
      doctor: { token: doctorToken.value, voice: DOCTOR_VOICE, persona: script.doctorPersona },
      patient: { token: patientToken.value, voice: PATIENT_VOICE, persona: script.patientPersona },
      doctorBeats: script.doctorBeats,
      patientBeats: script.patientBeats,
      doctorFree: script.doctorFree,
      patientFree: script.patientFree,
      patientName: saved.record.patient.name,
    });
  } catch (err) {
    return apiError((err as Error).message, 500);
  }
}
