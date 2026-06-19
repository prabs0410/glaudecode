// VAPID application-server keys for Web Push (V6 Phase 3.1, BL-5). A browser PushManager subscribes
// against the server's VAPID PUBLIC key, and every push is signed with the PRIVATE key — so the keys
// MUST be stable across engine restarts (regenerating would silently invalidate every existing phone
// subscription). They're generated once on first run and persisted 0600. Push *delivery* (the signed
// web-push request) is HTTPS-gated and intentionally NOT built here — this is the key + subscribe
// scaffolding only.

import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface VapidKeys {
  /** Uncompressed EC P-256 point (0x04‖X‖Y), base64url — what the browser PushManager subscribes with. */
  publicKey: string;
  /** Raw P-256 private scalar d, base64url — signs each push (used only by the HTTPS-gated sender). */
  privateKey: string;
}

const b64url = (b: Uint8Array): string => Buffer.from(b).toString("base64url");
const unb64url = (s: string): Buffer => Buffer.from(s, "base64url");

/** Derive VAPID keys from an EC P-256 keypair's JWK exports. The public key is the uncompressed point
 *  `0x04 ‖ X ‖ Y`; the private key is the raw scalar `d`. Pure → unit-testable from fixed JWKs. */
export function vapidKeysFromJwk(pub: { x?: string; y?: string }, priv: { d?: string }): VapidKeys {
  if (!pub.x || !pub.y || !priv.d) throw new Error("incomplete EC P-256 JWK");
  const point = Buffer.concat([Buffer.from([0x04]), unb64url(pub.x), unb64url(pub.y)]);
  if (point.length !== 65) throw new Error("bad EC P-256 point length");
  return { publicKey: b64url(point), privateKey: priv.d };
}

/** Generate a fresh VAPID keypair (EC P-256 / prime256v1). */
export function generateVapidKeys(): VapidKeys {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pubJwk = publicKey.export({ format: "jwk" }) as { x?: string; y?: string };
  const privJwk = privateKey.export({ format: "jwk" }) as { d?: string };
  return vapidKeysFromJwk(pubJwk, privJwk);
}

/** Load the persisted VAPID keys, generating + writing them (0600) on first run so the SAME public key
 *  survives restarts (a browser subscription is bound to it). A corrupt/partial file is regenerated. */
export function loadOrCreateVapidKeys(path: string): VapidKeys {
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      if (parsed && typeof parsed.publicKey === "string" && typeof parsed.privateKey === "string") {
        return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
      }
    } catch {
      /* corrupt file → fall through and regenerate */
    }
  }
  const keys = generateVapidKeys();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(keys), { mode: 0o600 });
  return keys;
}
