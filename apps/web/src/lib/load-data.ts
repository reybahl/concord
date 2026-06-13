import fs from "fs/promises";
import path from "path";

import type { SourceDoc } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const SOURCES_DIR = path.join(DATA_DIR, "sources");

interface SourceManifestEntry {
  id: string;
  filename: string;
  label: string;
  system: string;
  date?: string;
}

interface Manifest {
  sources: SourceManifestEntry[];
}

/** Load source documents listed in data/manifest.json from data/sources/. */
export async function loadSourceDocuments(): Promise<SourceDoc[]> {
  const manifest = JSON.parse(
    await fs.readFile(path.join(DATA_DIR, "manifest.json"), "utf-8"),
  ) as Manifest;

  return Promise.all(
    manifest.sources.map(async (entry) => ({
      id: entry.id,
      label: entry.label,
      system: entry.system,
      date: entry.date,
      text: await fs.readFile(path.join(SOURCES_DIR, entry.filename), "utf-8"),
    })),
  );
}

/** Optional seed vocabulary / answer-key JSON for coding and reconciliation. */
export async function loadSeedCodes(): Promise<unknown> {
  const raw = await fs.readFile(path.join(DATA_DIR, "seed-codes.json"), "utf-8");
  return JSON.parse(raw) as unknown;
}
