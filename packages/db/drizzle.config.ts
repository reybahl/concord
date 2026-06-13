import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load the monorepo-root .env so `pnpm db:push` works from packages/db.
config({ path: "../../.env" });

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://concord:concord@localhost:5432/concord",
  },
});
