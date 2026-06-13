import { listUploadedDocuments, uploadDocument, isStorageConfigured } from "@/lib/documents";
import { apiError, apiOk } from "@/lib/api";
import { getOrCreateSessionId, getSessionId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!isStorageConfigured()) {
      return apiOk({
        configured: false,
        error: "Storage is not configured. Set DATABASE_URL and BLOB_READ_WRITE_TOKEN (see .env.example).",
        documents: [],
      });
    }

    const sessionId = (await getSessionId()) ?? (await getOrCreateSessionId());
    const documents = await listUploadedDocuments(sessionId);
    return apiOk({ documents, configured: true });
  } catch (err) {
    return apiError((err as Error).message, 500);
  }
}

export async function POST(req: Request) {
  try {
    if (!isStorageConfigured()) {
      return apiError("Storage is not configured (DATABASE_URL + BLOB_READ_WRITE_TOKEN required).", 503);
    }

    const sessionId = await getOrCreateSessionId();
    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return apiError("Missing file upload.");
    }

    const system = form.get("system");
    const document = await uploadDocument(
      sessionId,
      file,
      typeof system === "string" ? system : null,
    );

    return apiOk({ document }, { status: 201 });
  } catch (err) {
    return apiError((err as Error).message, 400);
  }
}
