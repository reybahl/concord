import { isStorageConfigured } from "@/lib/documents";
import { apiError, apiOk } from "@/lib/api";
import { getLatestRecordForSession } from "@/lib/reconciled-records";
import { getOrCreateSessionId, getSessionId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Returns the latest saved reconciliation for this session, if any. */
export async function GET() {
  try {
    if (!isStorageConfigured()) {
      return apiOk({ configured: false, saved: null });
    }

    const sessionId = (await getSessionId()) ?? (await getOrCreateSessionId());
    const saved = await getLatestRecordForSession(sessionId);
    return apiOk({ configured: true, saved });
  } catch (err) {
    return apiError((err as Error).message, 500);
  }
}
