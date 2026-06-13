import { isStorageConfigured } from "@/lib/documents";
import { apiError, apiOk } from "@/lib/api";
import { guardianInstructions } from "@/lib/guardian";
import { getLatestRecordForSession } from "@/lib/reconciled-records";
import { getOrCreateSessionId, getSessionId } from "@/lib/session";
import { hasVoice, mintRealtimeToken } from "@/lib/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Boot a Guardian session: mint an ephemeral realtime token and return the
 * session configuration (instructions grounded in the reconciled record) so the
 * browser can open the WebSocket directly. Conflict detection happens
 * server-side via /api/guardian/assess, not as a model-driven tool call.
 */
export async function POST() {
  if (!hasVoice()) {
    return apiError("Voice is not configured (XAI_API_KEY required).", 503);
  }
  if (!isStorageConfigured()) {
    return apiError("Storage is not configured (DATABASE_URL + BLOB_READ_WRITE_TOKEN required).", 503);
  }

  try {
    const sessionId = (await getSessionId()) ?? (await getOrCreateSessionId());
    const saved = await getLatestRecordForSession(sessionId);

    if (!saved) {
      return apiError("Reconcile a health record first — the Guardian needs it to know what's unsafe.", 400);
    }

    const token = await mintRealtimeToken(900);

    return apiOk({
      token: token.value,
      expiresAt: token.expiresAt,
      model: token.model,
      voice: token.voice,
      instructions: guardianInstructions(saved.record),
      patientName: saved.record.patient.name,
    });
  } catch (err) {
    return apiError((err as Error).message, 500);
  }
}
