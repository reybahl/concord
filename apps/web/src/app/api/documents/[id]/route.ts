import {
  deleteUploadedDocument,
  getUploadedDocumentContent,
  isStorageConfigured,
} from "@/lib/documents";
import { apiError, apiOk } from "@/lib/api";
import { getOrCreateSessionId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    if (!isStorageConfigured()) {
      return apiError("Storage is not configured (DATABASE_URL + BLOB_READ_WRITE_TOKEN required).", 503);
    }

    const { id } = await params;
    const sessionId = await getOrCreateSessionId();
    const { document, text } = await getUploadedDocumentContent(sessionId, id);

    if (new URL(req.url).searchParams.get("inline") === "1") {
      return new Response(text, {
        headers: {
          "Content-Type": `${document.mimeType}; charset=utf-8`,
          "Content-Disposition": `inline; filename="${document.filename.replace(/"/g, "")}"`,
          "Cache-Control": "private, no-store",
        },
      });
    }

    return apiOk({ document, text });
  } catch (err) {
    return apiError((err as Error).message, 404);
  }
}

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
