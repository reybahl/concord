import { del, get, put } from "@vercel/blob";

/** True when the Blob read-write token is present (local dev + legacy stores). */
export function isBlobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export function requireBlobToken(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error(
      "Vercel Blob is not configured. Run `vercel link`, create a Blob store, then `vercel env pull`.",
    );
  }
  return token;
}

export function buildBlobPathname(
  sessionId: string,
  documentId: string,
  filename: string,
): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `uploads/${sessionId}/${documentId}/${safe}`;
}

export async function putBlob(
  pathname: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  const blob = await put(pathname, body, {
    access: "private",
    contentType,
    addRandomSuffix: false,
    token: requireBlobToken(),
  });
  return blob.url;
}

export async function getBlobText(url: string): Promise<string> {
  const buffer = await getBlobBytes(url);
  return buffer.toString("utf-8");
}

export async function getBlobBytes(url: string): Promise<Buffer> {
  const result = await get(url, {
    access: "private",
    token: requireBlobToken(),
  });
  if (!result || result.statusCode !== 200 || !result.stream) {
    throw new Error(`Failed to read blob: ${url}`);
  }
  const arrayBuffer = await new Response(result.stream).arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function deleteBlob(url: string): Promise<void> {
  await del(url, { token: requireBlobToken() });
}
