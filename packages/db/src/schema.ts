import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
 * A saved, patient-owned reconciled health record. The full reconciled
 * structure (facts, provenance, insights, sources) is stored as JSON so the
 * pipeline can evolve without migrations during the hackathon.
 */
export const records = pgTable("records", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id),
  title: text("title").notNull(),
  reconciled: jsonb("reconciled").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type RecordRow = typeof records.$inferSelect;
export type NewRecordRow = typeof records.$inferInsert;
