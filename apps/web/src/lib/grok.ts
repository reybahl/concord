import { createXai } from "@ai-sdk/xai";

/**
 * All xAI/Grok access is funneled through this module. When XAI_API_KEY is
 * absent the provider is null and callers fall back to the deterministic
 * pipeline — so scaffolding, local dev, and the live demo never hard-fail on a
 * missing key.
 */
export const hasXai = Boolean(process.env.XAI_API_KEY);

export const xai = hasXai
  ? createXai({ apiKey: process.env.XAI_API_KEY })
  : null;

/** Reasoning model used for extraction/reconciliation/analysis. */
export const GROK_MODEL = "grok-4";

export function grokModel() {
  return xai ? xai(GROK_MODEL) : null;
}
