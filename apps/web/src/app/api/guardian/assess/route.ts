import { isStorageConfigured } from "@/lib/documents";
import { apiError, apiOk } from "@/lib/api";
import {
  answerFromRecord,
  checkClinicalAction,
  classifyUtterance,
  GUARDIAN_NAME_PATTERN,
} from "@/lib/guardian";
import { getLatestRecordForSession } from "@/lib/reconciled-records";
import { getOrCreateSessionId, getSessionId } from "@/lib/session";
import { hasVoice } from "@/lib/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Assess one finalized room utterance.
 *
 * - If the patient addresses the guardian by name, return a grounded spoken
 *   answer drawn from the record.
 * - Otherwise a cheap classifier decides whether the utterance proposes a
 *   clinical action; only then do we run the expensive, grounded safety check.
 *
 * Everything the guardian says aloud originates here (server-side, grounded),
 * never from the realtime model's own generation.
 */
export async function POST(req: Request) {
  if (!hasVoice()) return apiError("Voice is not configured (XAI_API_KEY required).", 503);
  if (!isStorageConfigured()) return apiError("Storage is not configured.", 503);

  let body: { utterance?: string } | null;
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return apiError("Invalid request body.");
  }

  const utterance = body?.utterance?.trim();
  if (!utterance) return apiError("Missing utterance.");

  try {
    if (GUARDIAN_NAME_PATTERN.test(utterance)) {
      const saved = await loadRecord();
      if (!saved) return apiError("No reconciled record to answer from.", 400);
      const answer = await answerFromRecord(saved.record, utterance);
      return apiOk({ answer });
    }

    const classification = await classifyUtterance(utterance);
    if (!classification.contains_clinical_action || !classification.action) {
      return apiOk({ clinical: false });
    }

    const saved = await loadRecord();
    if (!saved) return apiError("No reconciled record to check against.", 400);

    const verdict = await checkClinicalAction(
      saved.record,
      classification.action,
      classification.kind ?? "other",
      utterance,
    );
    return apiOk({ clinical: true, verdict });
  } catch (err) {
    return apiError((err as Error).message, 500);
  }
}

async function loadRecord() {
  const sessionId = (await getSessionId()) ?? (await getOrCreateSessionId());
  return getLatestRecordForSession(sessionId);
}
