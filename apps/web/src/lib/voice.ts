/**
 * xAI Voice Agent (Realtime) access. The Guardian runs in the browser over a
 * WebSocket to `wss://api.x.ai/v1/realtime`, authenticated with a short-lived
 * ephemeral token minted here server-side so the API key never reaches the client.
 */

const XAI_BASE = "https://api.x.ai/v1";

/** Preview voice model with tunable reasoning (high for the catch, none for chatter). */
export const VOICE_MODEL = "grok-voice-think-fast-1.1";

/** The built-in voice used for the Guardian — authoritative and clear. */
export const GUARDIAN_VOICE = "leo";

export interface RealtimeToken {
  value: string;
  expiresAt: number;
  model: string;
  voice: string;
}

export function hasVoice(): boolean {
  return Boolean(process.env.XAI_API_KEY);
}

/** Mint an ephemeral client secret for a browser realtime session. */
export async function mintRealtimeToken(seconds = 600): Promise<RealtimeToken> {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new Error("XAI_API_KEY is not set — cannot start a voice session.");

  const res = await fetch(`${XAI_BASE}/realtime/client_secrets`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    // Intentionally omit `model` here: the preview model is pinned on the WS URL
    // query param instead, so an unknown-enum value can't reject the token.
    body: JSON.stringify({ expires_after: { seconds } }),
  });

  if (!res.ok) {
    throw new Error(
      `Failed to mint realtime token (${res.status}): ${(await res.text()).slice(0, 300)}`,
    );
  }

  const data = (await res.json()) as { value?: string; expires_at?: number };
  if (!data.value) throw new Error("Realtime token response missing value.");

  return {
    value: data.value,
    expiresAt: data.expires_at ?? 0,
    model: VOICE_MODEL,
    voice: GUARDIAN_VOICE,
  };
}
