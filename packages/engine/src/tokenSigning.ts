// HMAC-signed remote tokens (V8 Phase 2 / C1). The old model held each paired token in an in-memory
// Map, so an engine respawn logged every phone out. Instead a token is now a SIGNED capability —
// `base64url(deviceId.scope).base64url(HMAC-SHA256(deviceId.scope, key))` — so it's unforgeable
// without the signing key and self-verifies after a restart. The ONLY secret at rest is the 32-byte
// signing key (0600); the bearer token itself still never touches the Mac's disk (it lives on the
// phone). Authoritative scope + expiry + revocation live in the persisted device roster (deviceStore),
// not the token. Pure (key injected) → unit-tested.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Load the persisted token-signing key, generating + writing it (0600) on first run so signed tokens
 *  survive an engine respawn. A short/corrupt file is regenerated (which logs existing devices out — a
 *  fail-safe, not a crash). */
export function loadOrCreateSigningKey(path: string): Buffer {
  if (existsSync(path)) {
    try {
      const b = Buffer.from(readFileSync(path, "utf8").trim(), "base64url");
      if (b.length >= 32) return b;
      // Surface the reset — regenerating invalidates every signed token (all paired devices re-pair).
      console.error("[glaudecode] token-signing key is too short — regenerating; all paired devices must re-pair");
    } catch {
      console.error("[glaudecode] token-signing key is unreadable — regenerating; all paired devices must re-pair");
    }
  }
  const key = randomBytes(32);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, key.toString("base64url"), { mode: 0o600 });
  return key;
}

const b64url = (b: Uint8Array): string => Buffer.from(b).toString("base64url");

/** Mint a signed token binding a deviceId + scope. The deviceId is opaque hex (no dot); scope is a
 *  short word — so the inner `.` separator is unambiguous. */
export function signDeviceToken(deviceId: string, scope: string, key: Buffer): string {
  const payload = `${deviceId}.${scope}`;
  const sig = createHmac("sha256", key).update(payload).digest();
  return `${b64url(Buffer.from(payload, "utf8"))}.${b64url(sig)}`;
}

/** Verify a token's signature and recover its (deviceId, scope). Returns null on any malformation or a
 *  bad signature (timing-safe). Does NOT check expiry/revocation — the caller consults the device
 *  roster for those (so the roster remains the single authority and a token can be revoked server-side). */
export function verifyDeviceToken(token: string, key: Buffer): { deviceId: string; scope: string } | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  let payload: string;
  let sig: Buffer;
  try {
    payload = Buffer.from(parts[0], "base64url").toString("utf8");
    sig = Buffer.from(parts[1], "base64url");
  } catch {
    return null;
  }
  const expected = createHmac("sha256", key).update(payload).digest();
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
  const i = payload.indexOf(".");
  if (i <= 0 || i >= payload.length - 1) return null;
  return { deviceId: payload.slice(0, i), scope: payload.slice(i + 1) };
}
