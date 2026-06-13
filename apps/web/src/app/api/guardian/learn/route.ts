import { isStorageConfigured, uploadTextDocument } from "@/lib/documents";
import { apiError, apiOk } from "@/lib/api";
import { transcriptToVisitNote } from "@/lib/guardian";
import { getOrCreateSessionId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TranscriptTurn {
  role: "room" | "guardian";
  text: string;
}

/**
 * Learn loop: persist a finished Guardian visit as a new source document so it
 * re-enters the reconciliation pipeline. The longitudinal record grows itself.
 */
export async function POST(req: Request) {
  if (!isStorageConfigured()) {
    return apiError("Storage is not configured (DATABASE_URL + BLOB_READ_WRITE_TOKEN required).", 503);
  }

  let body: { transcript?: TranscriptTurn[] } | null;
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return apiError("Invalid request body.");
  }

  const turns = (body?.transcript ?? []).filter(
    (t): t is TranscriptTurn =>
      (t?.role === "room" || t?.role === "guardian") && typeof t?.text === "string" && t.text.trim().length > 0,
  );
  if (turns.length === 0) return apiError("Nothing was captured in this visit.");

  try {
    const sessionId = await getOrCreateSessionId();
    const note = transcriptToVisitNote(turns);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const document = await uploadTextDocument(
      sessionId,
      `guardian-visit-${stamp}.txt`,
      note,
      "Concord Guardian (live visit)",
    );
    return apiOk({ document }, { status: 201 });
  } catch (err) {
    return apiError((err as Error).message, 500);
  }
}
