import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load monorepo-root env (.env.local overrides .env).
config({ path: "../../.env" });
config({ path: "../../.env.local", override: true });

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://concord:concord@localhost:5432/concord",
  },
});
