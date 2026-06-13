import { isStorageConfigured, loadSourceDocumentsForSession } from "@/lib/documents";
import { apiError } from "@/lib/api";
import { runPipeline } from "@/lib/pipeline";
import { getOrCreateSessionId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Streams pipeline progress as newline-delimited JSON (one PipelineEvent per line). */
export async function POST(req: Request) {
  if (!isStorageConfigured()) {
    return apiError("Storage is not configured (DATABASE_URL + BLOB_READ_WRITE_TOKEN required).", 503);
  }

  const sessionId = await getOrCreateSessionId();
  let documentIds: string[] | undefined;

  try {
    const body = (await req.json().catch(() => null)) as { documentIds?: string[] } | null;
    documentIds = body?.documentIds;
  } catch {
    documentIds = undefined;
  }

  let sources;
  try {
    sources = await loadSourceDocumentsForSession(sessionId, documentIds);
  } catch (err) {
    return apiError((err as Error).message, 400);
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of runPipeline(sources)) {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({ type: "error", message: (err as Error).message })}\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
