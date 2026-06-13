import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export * from "./schema";
export { schema };

const url = process.env.DATABASE_URL;

/** True when a DATABASE_URL is present. The app works without it (persistence is skipped). */
export const isDbConfigured = Boolean(url);

/**
 * Drizzle client, or `null` when no DATABASE_URL is set. Keeping the DB optional
 * at runtime means a DB/network hiccup can never break the live demo — persistence
 * is additive, not a hard dependency of the reconciliation pipeline.
 */
export const db = url
  ? drizzle(postgres(url, { max: 1 }), { schema })
  : null;

export type Db = NonNullable<typeof db>;
