/**
 * Cross-tab signaling between the Guardian tab and the simulated room tab.
 *
 * Both tabs are same-origin, so a BroadcastChannel is the simplest reliable
 * link: when the Guardian starts speaking it broadcasts "guardian-speaking" and
 * the room pauses its conversation; when the Guardian finishes it broadcasts
 * "guardian-idle" and the room resumes.
 */

export const GUARDIAN_CHANNEL = "concord-guardian";

export type GuardianSignal = { type: "guardian-speaking" } | { type: "guardian-idle" };

export function postGuardianSignal(signal: GuardianSignal): void {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(GUARDIAN_CHANNEL);
  channel.postMessage(signal);
  channel.close();
}

/** Subscribe to guardian signals. Returns an unsubscribe function. */
export function subscribeGuardianSignal(handler: (signal: GuardianSignal) => void): () => void {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return () => undefined;
  const channel = new BroadcastChannel(GUARDIAN_CHANNEL);
  channel.onmessage = (event) => handler(event.data as GuardianSignal);
  return () => channel.close();
}
