import { db, isDbConfigured, sourceDocuments } from "@concord/db";
import { and, asc, eq, inArray } from "drizzle-orm";

import {
  buildBlobPathname,
  deleteBlob,
  getBlobText,
  isBlobConfigured,
  putBlob,
} from "./blob";
import type { SourceDoc } from "./types";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_FILES_PER_SESSION = 20;

const TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/octet-stream",
]);

export interface UploadedDocumentDto {
  id: string;
  filename: string;
  label: string;
  system: string | null;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export function isStorageConfigured(): boolean {
  return isDbConfigured && isBlobConfigured();
}

function requireDb() {
  if (!db) {
    throw new Error("DATABASE_URL is not configured.");
  }
  return db;
}

function labelFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "");
  return base.replace(/[-_]+/g, " ").trim() || filename;
}

function assertTextUpload(file: File) {
  const ext = file.name.split(".").pop()?.toLowerCase();
  const mimeOk = TEXT_MIME_TYPES.has(file.type) || file.type === "";
  const extOk = ext === "txt" || ext === "md";
  if (!mimeOk && !extOk) {
    throw new Error("Only .txt and .md files are supported for now.");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`File too large (max ${MAX_FILE_BYTES / (1024 * 1024)} MB).`);
  }
  if (file.size === 0) {
    throw new Error("File is empty.");
  }
}

export async function listUploadedDocuments(sessionId: string): Promise<UploadedDocumentDto[]> {
  const rows = await requireDb()
    .select()
    .from(sourceDocuments)
    .where(eq(sourceDocuments.sessionId, sessionId))
    .orderBy(asc(sourceDocuments.createdAt));

  return rows.map(toDto);
}

export async function uploadDocument(
  sessionId: string,
  file: File,
  system?: string | null,
): Promise<UploadedDocumentDto> {
  assertTextUpload(file);

  const existing = await listUploadedDocuments(sessionId);
  if (existing.length >= MAX_FILES_PER_SESSION) {
    throw new Error(`Maximum ${MAX_FILES_PER_SESSION} files per session.`);
  }

  const documentId = crypto.randomUUID();
  const buffer = Buffer.from(await file.arrayBuffer());
  const pathname = buildBlobPathname(sessionId, documentId, file.name);
  const mimeType = file.type || "text/plain";

  const blobUrl = await putBlob(pathname, buffer, mimeType);

  try {
    const [row] = await requireDb()
      .insert(sourceDocuments)
      .values({
        id: documentId,
        sessionId,
        filename: file.name,
        label: labelFromFilename(file.name),
        system: system?.trim() || null,
        mimeType,
        sizeBytes: file.size,
        blobUrl,
      })
      .returning();

    if (!row) throw new Error("Failed to save document metadata.");
    return toDto(row);
  } catch (err) {
    await deleteBlob(blobUrl).catch(() => undefined);
    throw err;
  }
}

export async function getUploadedDocumentContent(
  sessionId: string,
  documentId: string,
): Promise<{ document: UploadedDocumentDto; text: string }> {
  const [row] = await requireDb()
    .select()
    .from(sourceDocuments)
    .where(and(eq(sourceDocuments.id, documentId), eq(sourceDocuments.sessionId, sessionId)));

  if (!row) throw new Error("Document not found.");

  const text = await getBlobText(row.blobUrl);
  return { document: toDto(row), text };
}

export async function deleteUploadedDocument(sessionId: string, documentId: string): Promise<void> {
  const [row] = await requireDb()
    .select()
    .from(sourceDocuments)
    .where(and(eq(sourceDocuments.id, documentId), eq(sourceDocuments.sessionId, sessionId)));

  if (!row) throw new Error("Document not found.");

  await deleteBlob(row.blobUrl);
  await requireDb().delete(sourceDocuments).where(eq(sourceDocuments.id, documentId));
}

export async function loadSourceDocumentsForSession(
  sessionId: string,
  documentIds?: string[],
): Promise<SourceDoc[]> {
  const where =
    documentIds && documentIds.length > 0
      ? and(eq(sourceDocuments.sessionId, sessionId), inArray(sourceDocuments.id, documentIds))
      : eq(sourceDocuments.sessionId, sessionId);

  const rows = await requireDb()
    .select()
    .from(sourceDocuments)
    .where(where)
    .orderBy(asc(sourceDocuments.createdAt));

  if (rows.length === 0) {
    throw new Error("Upload at least one medical record before reconciling.");
  }

  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      label: row.label,
      system: row.system ?? "Unknown source",
      date: row.createdAt.toISOString().slice(0, 10),
      text: await getBlobText(row.blobUrl),
    })),
  );
}

function toDto(row: typeof sourceDocuments.$inferSelect): UploadedDocumentDto {
  return {
    id: row.id,
    filename: row.filename,
    label: row.label,
    system: row.system,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt.toISOString(),
  };
}
