import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Auth-ready user table. Auth (Better Auth / NextAuth) drops in later and
 * points sessions at this table — no restructure needed.
 */
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").unique(),
  name: text("name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Uploaded source document metadata. Raw bytes live in Vercel Blob; this row
 * is the pointer + display fields for the UI and pipeline.
 */
export const sourceDocuments = pgTable("source_documents", {
  id: uuid("id").primaryKey(),
  /** Anonymous session cookie until auth lands; then filter by userId instead. */
  sessionId: text("session_id").notNull(),
  userId: uuid("user_id").references(() => users.id),
  filename: text("filename").notNull(),
  label: text("label").notNull(),
  system: text("system"),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  blobUrl: text("blob_url").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * A saved, patient-owned reconciled health record. The full reconciled
 * structure (facts, provenance, insights, sources) is stored as JSON so the
 * pipeline can evolve without migrations during the hackathon.
 *
 * One row per anonymous session (until auth lands and we key by userId instead).
 * `sourceDocumentIds` is the snapshot of uploads used for this reconcile — the
 * UI compares it to the live upload list to show a stale banner.
 */
export const records = pgTable("records", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: text("session_id").notNull().unique(),
  userId: uuid("user_id").references(() => users.id),
  title: text("title").notNull(),
  /** Which uploaded documents were included in this reconciliation. */
  sourceDocumentIds: text("source_document_ids").array().notNull(),
  reconciled: jsonb("reconciled").notNull(),
  /** Full pipeline stage + note history for replay in the UI. */
  pipelineLog: jsonb("pipeline_log"),
  reconciledAt: timestamp("reconciled_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type SourceDocumentRow = typeof sourceDocuments.$inferSelect;
export type NewSourceDocumentRow = typeof sourceDocuments.$inferInsert;
export type RecordRow = typeof records.$inferSelect;
export type NewRecordRow = typeof records.$inferInsert;
