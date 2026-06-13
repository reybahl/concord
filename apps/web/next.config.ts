import { config } from "dotenv";
import type { NextConfig } from "next";

// Monorepo-root env files (`.env.local` overrides `.env`, e.g. after `vercel env pull`).
config({ path: "../../.env" });
config({ path: "../../.env.local", override: true });

const nextConfig: NextConfig = {
  // The @concord/db package ships TypeScript source; let Next transpile it.
  transpilePackages: ["@concord/db"],
};

export default nextConfig;
