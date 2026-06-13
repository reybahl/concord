import { deleteUploadedDocument, isStorageConfigured } from "@/lib/documents";
import { apiError, apiOk } from "@/lib/api";
import { getOrCreateSessionId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    if (!isStorageConfigured()) {
      return apiError("Storage is not configured (DATABASE_URL + BLOB_READ_WRITE_TOKEN required).", 503);
    }

    const { id } = await params;
    const sessionId = await getOrCreateSessionId();
    await deleteUploadedDocument(sessionId, id);
    return apiOk({ ok: true });
  } catch (err) {
    return apiError((err as Error).message, 404);
  }
}
