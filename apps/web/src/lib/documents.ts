import { db, isDbConfigured, sourceDocuments } from "@concord/db";
import { and, asc, eq, inArray } from "drizzle-orm";

import {
  buildBlobPathname,
  deleteBlob,
  getBlobBytes,
  getBlobText,
  isBlobConfigured,
  putBlob,
} from "./blob";
import { deleteRecordForSession } from "./reconciled-records";
import { isPdfMimeType } from "./mime";
import type { SourceDoc } from "./types";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_FILES_PER_SESSION = 20;

const ALLOWED_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/pdf",
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

function fileExtension(filename: string): string | undefined {
  return filename.split(".").pop()?.toLowerCase();
}

function resolveMimeType(filename: string, fileType: string): string {
  if (fileType && fileType !== "application/octet-stream") return fileType;
  const ext = fileExtension(filename);
  if (ext === "pdf") return "application/pdf";
  if (ext === "md") return "text/markdown";
  return "text/plain";
}

function assertAllowedUpload(file: File) {
  const ext = fileExtension(file.name);
  const extOk = ext === "txt" || ext === "md" || ext === "pdf";
  const mimeOk = ALLOWED_MIME_TYPES.has(file.type) || file.type === "";
  if (!mimeOk && !extOk) {
    throw new Error("Supported formats: .txt, .md, and .pdf");
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
  assertAllowedUpload(file);
  return persistDocument(sessionId, {
    filename: file.name,
    buffer: Buffer.from(await file.arrayBuffer()),
    mimeType: resolveMimeType(file.name, file.type),
    sizeBytes: file.size,
    system,
  });
}

/** Persist a generated text document (e.g. a captured Guardian visit) as a source. */
export async function uploadTextDocument(
  sessionId: string,
  filename: string,
  text: string,
  system?: string | null,
): Promise<UploadedDocumentDto> {
  const buffer = Buffer.from(text, "utf-8");
  if (buffer.byteLength === 0) throw new Error("Cannot save an empty document.");
  return persistDocument(sessionId, {
    filename,
    buffer,
    mimeType: "text/plain",
    sizeBytes: buffer.byteLength,
    system,
  });
}

async function persistDocument(
  sessionId: string,
  doc: { filename: string; buffer: Buffer; mimeType: string; sizeBytes: number; system?: string | null },
): Promise<UploadedDocumentDto> {
  const existing = await listUploadedDocuments(sessionId);
  if (existing.length >= MAX_FILES_PER_SESSION) {
    throw new Error(`Maximum ${MAX_FILES_PER_SESSION} files per session.`);
  }

  const documentId = crypto.randomUUID();
  const pathname = buildBlobPathname(sessionId, documentId, doc.filename);
  const blobUrl = await putBlob(pathname, doc.buffer, doc.mimeType);

  try {
    const [row] = await requireDb()
      .insert(sourceDocuments)
      .values({
        id: documentId,
        sessionId,
        filename: doc.filename,
        label: labelFromFilename(doc.filename),
        system: doc.system?.trim() || null,
        mimeType: doc.mimeType,
        sizeBytes: doc.sizeBytes,
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
): Promise<{
  document: UploadedDocumentDto;
  text: string;
  bytes: Buffer;
  isPdf: boolean;
}> {
  const [row] = await requireDb()
    .select()
    .from(sourceDocuments)
    .where(and(eq(sourceDocuments.id, documentId), eq(sourceDocuments.sessionId, sessionId)));

  if (!row) throw new Error("Document not found.");

  const bytes = await getBlobBytes(row.blobUrl);
  const isPdf = isPdfMimeType(row.mimeType);
  const text = isPdf ? "" : bytes.toString("utf-8");

  return { document: toDto(row), text, bytes, isPdf };
}

/** Remove every upload and the saved reconciled record for this session. */
export async function clearSessionWorkspace(sessionId: string): Promise<{ documentsRemoved: number }> {
  const docs = await listUploadedDocuments(sessionId);
  for (const doc of docs) {
    await deleteUploadedDocument(sessionId, doc.id);
  }
  await deleteRecordForSession(sessionId);
  return { documentsRemoved: docs.length };
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
    rows.map(async (row) => {
      const isPdf = isPdfMimeType(row.mimeType);
      return {
        id: row.id,
        label: row.label,
        filename: row.filename,
        system: row.system ?? "Unknown source",
        date: row.createdAt.toISOString().slice(0, 10),
        mimeType: row.mimeType,
        blobUrl: row.blobUrl,
        text: isPdf ? "" : await getBlobText(row.blobUrl),
      };
    }),
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
