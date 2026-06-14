import { db, isDbConfigured, records } from "@concord/db";
import { desc, eq } from "drizzle-orm";

import type { PipelineRunLog } from "./pipeline-log";
import type { HealthRecord } from "./types";

export interface SavedRecordDto {
  id: string;
  title: string;
  record: HealthRecord;
  sourceDocumentIds: string[];
  reconciledAt: string;
  pipelineLog: PipelineRunLog | null;
}

function requireDb() {
  if (!db) {
    throw new Error("DATABASE_URL is not configured.");
  }
  return db;
}

/** True when the saved snapshot matches the current upload set (order-independent). */
export function documentSetsMatch(savedIds: string[], currentIds: string[]): boolean {
  if (savedIds.length !== currentIds.length) return false;
  const a = [...savedIds].sort();
  const b = [...currentIds].sort();
  return a.every((id, i) => id === b[i]);
}

export async function getLatestRecordForSession(sessionId: string): Promise<SavedRecordDto | null> {
  if (!isDbConfigured) return null;

  const [row] = await requireDb()
    .select()
    .from(records)
    .where(eq(records.sessionId, sessionId))
    .orderBy(desc(records.reconciledAt))
    .limit(1);

  if (!row) return null;
  return toDto(row);
}

export async function deleteRecordForSession(sessionId: string): Promise<void> {
  if (!isDbConfigured) return;
  await requireDb().delete(records).where(eq(records.sessionId, sessionId));
}

export async function saveRecordForSession(
  sessionId: string,
  sourceDocumentIds: string[],
  record: HealthRecord,
  pipelineLog: PipelineRunLog,
): Promise<SavedRecordDto> {
  const title = record.patient.name?.trim() || "Reconciled health record";
  const reconciledAt = new Date();

  const [row] = await requireDb()
    .insert(records)
    .values({
      sessionId,
      title,
      sourceDocumentIds,
      reconciled: record,
      pipelineLog,
      reconciledAt,
    })
    .onConflictDoUpdate({
      target: records.sessionId,
      set: {
        title,
        sourceDocumentIds,
        reconciled: record,
        pipelineLog,
        reconciledAt,
      },
    })
    .returning();

  if (!row) throw new Error("Failed to save reconciled record.");
  return toDto(row);
}

function toDto(row: typeof records.$inferSelect): SavedRecordDto {
  return {
    id: row.id,
    title: row.title,
    record: row.reconciled as HealthRecord,
    sourceDocumentIds: row.sourceDocumentIds,
    reconciledAt: row.reconciledAt.toISOString(),
    pipelineLog: (row.pipelineLog as PipelineRunLog | null) ?? null,
  };
}
