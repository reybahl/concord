import { config } from "dotenv";
import type { NextConfig } from "next";

// Load the monorepo-root .env (single source of truth) for local dev.
// On Vercel, env vars come from the dashboard / Neon integration instead.
config({ path: "../../.env" });

const nextConfig: NextConfig = {
  // The @concord/db package ships TypeScript source; let Next transpile it.
  transpilePackages: ["@concord/db"],
};

export default nextConfig;
