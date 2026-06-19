// Web Push subscription store (V6 Phase 3.2, BL-5). A paired phone POSTs its PushSubscription (the
// browser's endpoint + p256dh/auth keys) to /push-subscribe; we persist it keyed by deviceId at
// ~/.glaudecode/push-subscriptions.json so it survives engine restarts. Revoking a device drops its
// subscription. The actual SEND (a signed web-push request) is HTTPS-gated and lives elsewhere — this
// is storage + the shouldPush gate only.

import { homedir } from "node:os";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { NotificationKind } from "./notify";
import { shouldPush, type PushPolicy } from "./pushPolicy";

/** The browser PushManager subscription shape we persist (the fields a web-push sender needs). */
export interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime?: number | null;
}

interface StoredSub {
  deviceId: string;
  sub: PushSubscription;
  at: string;
}

/** Validate an untrusted POST body as a PushSubscription (an https endpoint + both key fields). Returns
 *  the normalised subscription, or null if malformed — the route 400s on null. */
export function parsePushSubscription(body: unknown): PushSubscription | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const endpoint = b.endpoint;
  const keys = b.keys as Record<string, unknown> | undefined;
  if (typeof endpoint !== "string" || !/^https:\/\//.test(endpoint) || endpoint.length > 2048) return null;
  if (!keys || typeof keys.p256dh !== "string" || typeof keys.auth !== "string") return null;
  if (keys.p256dh.length > 256 || keys.auth.length > 256) return null;
  return {
    endpoint,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
    expirationTime: typeof b.expirationTime === "number" ? b.expirationTime : null,
  };
}

export class PushSubscriptionStore {
  constructor(private readonly home: string = homedir()) {}

  private path(): string {
    return join(this.home, ".glaudecode", "push-subscriptions.json");
  }

  private read(): StoredSub[] {
    try {
      const raw = readFileSync(this.path(), "utf8");
      const parsed = raw.trim() ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e: any) {
      if (e?.code !== "ENOENT") {
        // surface a corrupt store — resetting it silently drops every device's push registration
        console.error("[glaudecode] push subscriptions store unreadable/corrupt — resetting; devices must re-enable alerts");
      }
      return []; // treated as empty rather than crashing the engine
    }
  }

  private write(list: StoredSub[]): void {
    const p = this.path();
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(list), { mode: 0o600 });
  }

  /** Upsert a subscription for a device (one current subscription per device). Returns the new count. */
  add(deviceId: string, sub: PushSubscription, at: string): number {
    const list = this.read().filter((s) => s.deviceId !== deviceId);
    list.push({ deviceId, sub, at });
    this.write(list);
    return list.length;
  }

  /** Drop a device's subscription (called on revoke). Returns true if one was removed. */
  remove(deviceId: string): boolean {
    const list = this.read();
    const next = list.filter((s) => s.deviceId !== deviceId);
    if (next.length === list.length) return false;
    this.write(next);
    return true;
  }

  list(): StoredSub[] {
    return this.read();
  }

  count(): number {
    return this.read().length;
  }
}

/** The shouldPush() CALL SITE: would a push be delivered for this event? True only when the policy says
 *  so (high-signal kind, session not muted) AND at least one device is subscribed. The actual delivery
 *  (a signed web-push to each endpoint) is HTTPS-gated and intentionally not performed here. */
export function wouldDeliverPush(
  kind: NotificationKind,
  sessionId: string | undefined,
  store: PushSubscriptionStore,
  policy: PushPolicy = {},
): boolean {
  if (!shouldPush(kind, sessionId, policy)) return false;
  return store.count() > 0;
}
