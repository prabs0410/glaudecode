// Push notify policy (V6 Phase 3.4). Which session events buzz the phone, and a per-session mute.
// The founder runs ~4-5 sessions, so per-message push would train ignore-behavior — only high-signal
// events fire: an approval needed, an AskUserQuestion waiting, a session finished/idle, or an error.
// NOT "budget" (a soft heads-up, not a "come back now"). Pure + tested; the push pipeline (P3.3) calls
// shouldPush() before sending a Web Push to a device's subscription.

import type { NotificationKind } from "./notify";

/** The notification kinds that warrant a push. Never per-message; "budget" is intentionally excluded. */
export const PUSH_KINDS: ReadonlySet<NotificationKind> = new Set<NotificationKind>([
  "approval",
  "question",
  "finished",
  "error",
]);

export interface PushPolicy {
  /** Session ids the user muted — no push for these (per-session mute). */
  mutedSessions?: ReadonlySet<string>;
}

/** Should this notification fire a push to the phone? */
export function shouldPush(
  kind: NotificationKind,
  sessionId: string | undefined,
  policy: PushPolicy = {},
): boolean {
  if (!PUSH_KINDS.has(kind)) return false;
  if (sessionId && policy.mutedSessions?.has(sessionId)) return false;
  return true;
}
