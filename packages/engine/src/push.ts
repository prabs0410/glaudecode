// Web Push SENDER (V8 Phase 1, BL-5 delivery half). Hand-rolled on node:crypto — VAPID ES256 auth
// (RFC 8292) + RFC 8291 `aes128gcm` payload encryption — so the engine keeps its tiny dependency
// surface (no `web-push` npm tree). The one fiddly primitive is `encryptPayload`; if real-device QA
// ever fails, swap ONLY that function for `web-push`'s encrypt — everything else is standard.
//
// The PAYLOAD is metadata-only (a short title/body + kind + ids), never transcript text / tool input /
// file paths. Delivery to a real device is HTTPS-gated (the phone subscribes over Tailscale Serve);
// these functions are pure/injectable so the whole chain is unit-tested in CI without a network.

import { createECDH, createPrivateKey, hkdfSync, randomBytes, createCipheriv, sign as cryptoSign } from "node:crypto";
import type { NotificationKind } from "./notify";
import type { PushSubscriptionStore } from "./pushSubscriptions";

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface VapidConfig {
  /** Uncompressed EC P-256 public point (0x04‖X‖Y), base64url — also sent as the `k=` auth param. */
  publicKey: string;
  /** Raw P-256 private scalar d, base64url — signs the VAPID JWT. */
  privateKey: string;
  /** RFC 8292 `sub` — a mailto:/https contact. Intentionally non-PII for a self-hosted sender. */
  subject: string;
}

export interface PushMessage {
  title: string;
  body: string;
  kind: NotificationKind;
  sessionId?: string;
  paneId?: string;
  tag?: string;
}

export type SendFn = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: Uint8Array },
) => Promise<{ status: number }>;

const b64url = (b: Uint8Array): string => Buffer.from(b).toString("base64url");
const unb64url = (s: string): Buffer => Buffer.from(s, "base64url");
const utf8 = (s: string): Buffer => Buffer.from(s, "utf8");

/** VAPID ES256 auth header for one endpoint origin (RFC 8292). `t=` is the signed JWT, `k=` the public
 *  key. Pure given `now` (millis). */
export function vapidAuthHeader(endpointOrigin: string, vapid: VapidConfig, now: number): { authorization: string } {
  const header = b64url(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64url(
    utf8(JSON.stringify({ aud: endpointOrigin, exp: Math.floor(now / 1000) + 12 * 60 * 60, sub: vapid.subject })),
  );
  const signingInput = `${header}.${payload}`;
  // Reconstruct the signing key from d + the public point's X/Y (a JWK import).
  const point = unb64url(vapid.publicKey);
  const jwk = {
    kty: "EC",
    crv: "P-256",
    d: vapid.privateKey,
    x: b64url(point.subarray(1, 33)),
    y: b64url(point.subarray(33, 65)),
  };
  const key = createPrivateKey({ key: jwk, format: "jwk" });
  // ieee-p1363 → raw r‖s (64 bytes), the JWS ES256 form (NOT DER).
  const sig = cryptoSign("sha256", utf8(signingInput), { key, dsaEncoding: "ieee-p1363" });
  return { authorization: `vapid t=${signingInput}.${b64url(sig)},k=${vapid.publicKey}` };
}

/** RFC 8291 `aes128gcm` single-record encryption of `plaintext` to a subscription's (p256dh, auth).
 *  Returns the complete content-coding body: salt(16) ‖ rs(4) ‖ idlen(1) ‖ keyid(=server public, 65) ‖
 *  ciphertext‖tag. `eph` (ephemeral private + salt) is injectable so tests are deterministic. */
export function encryptPayload(
  plaintext: Uint8Array,
  p256dh: string,
  auth: string,
  eph?: { privateKey: Uint8Array; salt: Uint8Array },
): Buffer {
  const uaPublic = unb64url(p256dh); // recipient public point (65 bytes)
  const authSecret = unb64url(auth); // 16 bytes
  const ecdh = createECDH("prime256v1");
  if (eph) ecdh.setPrivateKey(Buffer.from(eph.privateKey));
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey(); // ephemeral/server public point (65 bytes), uncompressed
  const salt = Buffer.from(eph?.salt ?? randomBytes(16));
  const sharedSecret = ecdh.computeSecret(uaPublic); // 32-byte ECDH output

  // IKM (RFC 8291 §3.4): HKDF(salt=auth_secret, ikm=ecdh, info="WebPush: info\0"‖ua_public‖as_public).
  const ikmInfo = Buffer.concat([utf8("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", sharedSecret, authSecret, ikmInfo, 32));

  // Content key + nonce (RFC 8188 §2.3), salted by the record salt.
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, utf8("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, utf8("Content-Encoding: nonce\0"), 12));

  // Single record: plaintext ‖ 0x02 (the last-record delimiter), then AES-128-GCM.
  const padded = Buffer.concat([Buffer.from(plaintext), Buffer.from([0x02])]);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);

  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096, 0); // record size — one record, generous
  const idlen = Buffer.from([asPublic.length]); // 65
  return Buffer.concat([salt, rs, idlen, asPublic, ciphertext]);
}

/** Build the complete signed + encrypted Web Push HTTP request for ONE target. Pure (no I/O) — given
 *  `now` and an injected `eph` it is fully deterministic, so tests can assert + decrypt it. */
export function buildPushRequest(
  target: PushTarget,
  message: PushMessage,
  vapid: VapidConfig,
  now: number,
  eph?: { privateKey: Uint8Array; salt: Uint8Array },
): { url: string; headers: Record<string, string>; body: Uint8Array } {
  const origin = new URL(target.endpoint).origin;
  const plaintext = utf8(
    JSON.stringify({
      title: String(message.title).slice(0, 80),
      body: String(message.body).slice(0, 120),
      kind: message.kind,
      sessionId: message.sessionId,
      paneId: message.paneId,
      tag: message.tag,
    }),
  );
  const body = encryptPayload(plaintext, target.keys.p256dh, target.keys.auth, eph);
  return {
    url: target.endpoint,
    headers: {
      ...vapidAuthHeader(origin, vapid, now),
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: "2419200", // 28 days — the push service may hold it while the phone is offline
      urgency: "high",
    },
    body,
  };
}

export interface PushSenderDeps {
  store: PushSubscriptionStore;
  vapid: VapidConfig;
  /** Injected transport (defaults to fetch) — tests pass a fake so no network is hit. */
  send?: SendFn;
  now?: () => number;
  /** Called when a dead subscription (404/410) is pruned — for audit/observability. */
  onPruned?: (deviceId: string, status: number) => void;
  /** Called when a target FAILS (a non-2xx other than 404/410, or a thrown error) — so a persistently
   *  failing endpoint / bad VAPID key / malformed subscription is observable, not just tallied. The
   *  `reason` is the HTTP status, or an error NAME (never a message — those can carry endpoint detail). */
  onFailed?: (deviceId: string, reason: number | string) => void;
}

const defaultSend: SendFn = async (url, init) => {
  // The body is a Uint8Array (a valid BodyInit at runtime); cast to fetch's exact init type so this
  // stays portable across the engine's lib without a DOM/BodyInit dependency.
  const r = await fetch(url, init as Parameters<typeof fetch>[1]);
  return { status: r.status };
};

/** Fan a metadata-only push out to every stored subscription. NEVER throws — a per-target failure is
 *  counted and the loop continues; a 404/410 prunes the dead subscription. */
export class PushSender {
  private readonly store: PushSubscriptionStore;
  private readonly vapid: VapidConfig;
  private readonly send: SendFn;
  private readonly now: () => number;
  private readonly onPruned?: (deviceId: string, status: number) => void;
  private readonly onFailed?: (deviceId: string, reason: number | string) => void;

  constructor(deps: PushSenderDeps) {
    this.store = deps.store;
    this.vapid = deps.vapid;
    this.send = deps.send ?? defaultSend;
    this.now = deps.now ?? (() => Date.now());
    this.onPruned = deps.onPruned;
    this.onFailed = deps.onFailed;
  }

  async deliver(message: PushMessage): Promise<{ delivered: number; pruned: number; failed: number }> {
    let delivered = 0;
    let pruned = 0;
    let failed = 0;
    for (const { deviceId, sub } of this.store.list()) {
      try {
        const req = buildPushRequest({ endpoint: sub.endpoint, keys: sub.keys }, message, this.vapid, this.now());
        const { status } = await this.send(req.url, { method: "POST", headers: req.headers, body: req.body });
        if (status === 404 || status === 410) {
          this.store.remove(deviceId);
          this.onPruned?.(deviceId, status);
          pruned++;
        } else if (status >= 200 && status < 300) {
          delivered++;
        } else {
          failed++;
          this.onFailed?.(deviceId, status); // e.g. 401 bad VAPID, 413 too big, 5xx — fixable, must be seen
        }
      } catch (e: any) {
        failed++; // network/encryption error for one target never aborts the fan-out
        this.onFailed?.(deviceId, String(e?.name ?? "error")); // name only — no message (endpoint detail)
      }
    }
    return { delivered, pruned, failed };
  }
}
