import { createXai } from "@ai-sdk/xai";

/**
 * All xAI/Grok access is funneled through this module. When XAI_API_KEY is
 * absent the provider is null and callers fall back to the deterministic
 * record — so scaffolding, local dev, and the live demo never hard-fail on a
 * missing key.
 */
export const hasXai = Boolean(process.env.XAI_API_KEY);

const xai = hasXai ? createXai({ apiKey: process.env.XAI_API_KEY }) : null;

/**
 * Each pipeline step has different needs, so each gets the right Grok variant:
 * - `extract` is high-volume, mechanical structured output → fast, non-reasoning.
 * - `reconcile` is the hard step (entity resolution, coding, unit math) → reasoning.
 * - `analyze` is clinical judgement (interactions, trends) → reasoning.
 */
export const MODELS = {
  extract: "grok-4-fast-non-reasoning",
  reconcile: "grok-4-fast-reasoning",
  analyze: "grok-4-fast-reasoning",
} as const;

export type ModelRole = keyof typeof MODELS;

export function grokModel(role: ModelRole) {
  if (!xai) {
    throw new Error("XAI_API_KEY is not set — cannot reach Grok.");
  }
  return xai(MODELS[role]);
}
