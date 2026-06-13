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
    const { document, text, bytes, isPdf } = await getUploadedDocumentContent(sessionId, id);

    if (new URL(req.url).searchParams.get("inline") === "1") {
      const body = isPdf ? new Uint8Array(bytes) : text;
      const contentType = isPdf
        ? "application/pdf"
        : `${document.mimeType}; charset=utf-8`;

      return new Response(body, {
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `inline; filename="${document.filename.replace(/"/g, "")}"`,
          "Cache-Control": "private, no-store",
        },
      });
    }

    return apiOk({ document, text, isPdf });
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
