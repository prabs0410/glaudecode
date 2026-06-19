import { afterEach, describe, expect, test } from "bun:test";
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify as cryptoVerify } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPushRequest, encryptPayload, PushSender, vapidAuthHeader, type SendFn } from "../src/push";
import { generateVapidKeys } from "../src/pushKeys";
import { PushSubscriptionStore } from "../src/pushSubscriptions";

const NOW = 1_700_000_000_000;
const utf8 = (s: string) => Buffer.from(s, "utf8");
const vapid = { ...generateVapidKeys(), subject: "mailto:test@glaude" };

// A recipient (the "phone") keypair so the test can DECRYPT what encryptPayload produced.
function recipient() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const authSecret = randomBytes(16);
  return {
    p256dh: ecdh.getPublicKey().toString("base64url"),
    auth: authSecret.toString("base64url"),
    pubRaw: ecdh.getPublicKey(),
    privRaw: ecdh.getPrivateKey(),
    authSecret,
  };
}

/** Decrypt an RFC 8291 aes128gcm body back to plaintext — the inverse of encryptPayload, proving the
 *  whole ECDH→HKDF→AES-GCM chain is correct. */
function decrypt(body: Buffer, r: ReturnType<typeof recipient>): Buffer {
  const salt = body.subarray(0, 16);
  const idlen = body[20]!;
  const asPublic = body.subarray(21, 21 + idlen); // server/ephemeral public = keyid
  const record = body.subarray(21 + idlen);
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(r.privRaw);
  const shared = ecdh.computeSecret(asPublic);
  const ikm = Buffer.from(hkdfSync("sha256", shared, r.authSecret, Buffer.concat([utf8("WebPush: info\0"), r.pubRaw, asPublic]), 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, utf8("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, utf8("Content-Encoding: nonce\0"), 12));
  const tag = record.subarray(record.length - 16);
  const ct = record.subarray(0, record.length - 16);
  const dec = createDecipheriv("aes-128-gcm", cek, nonce);
  dec.setAuthTag(tag);
  const padded = Buffer.concat([dec.update(ct), dec.final()]);
  return padded.subarray(0, padded.length - 1); // strip the 0x02 last-record delimiter
}

describe("encryptPayload / buildPushRequest (RFC 8291 aes128gcm round-trips)", () => {
  test("the recipient can decrypt the body back to the exact metadata-only payload", () => {
    const r = recipient();
    const msg = { title: "Approval needed", body: "Bash", kind: "approval" as const, sessionId: "s1", paneId: "p1", tag: "s1:approval" };
    const req = buildPushRequest({ endpoint: "https://push.example/abc", keys: { p256dh: r.p256dh, auth: r.auth } }, msg, vapid, NOW);
    const decoded = JSON.parse(decrypt(req.body as Buffer, r).toString("utf8"));
    expect(decoded).toEqual({ title: "Approval needed", body: "Bash", kind: "approval", sessionId: "s1", paneId: "p1", tag: "s1:approval" });
  });

  test("the payload carries NO transcript / tool-input / secret beyond title+body+ids", () => {
    const r = recipient();
    const msg = { title: "x", body: "y", kind: "error" as const, sessionId: "s", secret: "TOPSECRET" } as any;
    const req = buildPushRequest({ endpoint: "https://push.example/x", keys: { p256dh: r.p256dh, auth: r.auth } }, msg, vapid, NOW);
    const text = decrypt(req.body as Buffer, r).toString("utf8");
    expect(text).not.toContain("TOPSECRET");
    const allowed = ["title", "body", "kind", "sessionId", "paneId", "tag"];
    expect(Object.keys(JSON.parse(text)).every((k) => allowed.includes(k))).toBe(true); // no disallowed field leaks
  });

  test("encryptPayload is deterministic given an injected ephemeral key + salt", () => {
    const r = recipient();
    const eph = { privateKey: (() => { const e = createECDH("prime256v1"); e.generateKeys(); return e.getPrivateKey(); })(), salt: randomBytes(16) };
    const a = encryptPayload(utf8("hello"), r.p256dh, r.auth, eph);
    const b = encryptPayload(utf8("hello"), r.p256dh, r.auth, eph);
    expect(a.equals(b)).toBe(true);
    expect(decrypt(a, r).toString("utf8")).toBe("hello");
  });

  test("the request headers are the aes128gcm + VAPID shape", () => {
    const r = recipient();
    const req = buildPushRequest({ endpoint: "https://fcm.googleapis.com/x/y", keys: { p256dh: r.p256dh, auth: r.auth } }, { title: "t", body: "b", kind: "finished" }, vapid, NOW);
    expect(req.headers["content-encoding"]).toBe("aes128gcm");
    expect(req.headers["content-type"]).toBe("application/octet-stream");
    expect(req.headers.authorization.startsWith("vapid t=")).toBe(true);
    expect(req.headers.authorization).toContain(",k=" + vapid.publicKey);
  });
});

describe("vapidAuthHeader (RFC 8292 ES256 JWT)", () => {
  test("the JWT verifies against the VAPID public key and binds aud=origin, exp~+12h, sub", () => {
    const { authorization } = vapidAuthHeader("https://push.example", vapid, NOW);
    const jwt = authorization.slice("vapid t=".length, authorization.indexOf(",k="));
    const [h, p, sig] = jwt.split(".");
    const point = Buffer.from(vapid.publicKey, "base64url");
    const pub = createPublicKey({ key: { kty: "EC", crv: "P-256", x: point.subarray(1, 33).toString("base64url"), y: point.subarray(33, 65).toString("base64url") }, format: "jwk" });
    const ok = cryptoVerify("sha256", utf8(`${h}.${p}`), { key: pub, dsaEncoding: "ieee-p1363" }, Buffer.from(sig!, "base64url"));
    expect(ok).toBe(true);
    const claims = JSON.parse(Buffer.from(p!, "base64url").toString("utf8"));
    expect(claims.aud).toBe("https://push.example");
    expect(claims.sub).toBe("mailto:test@glaude");
    expect(claims.exp).toBe(Math.floor(NOW / 1000) + 12 * 60 * 60);
  });
});

describe("PushSender.deliver (fan-out, pruning, never-throws)", () => {
  const tmps: string[] = [];
  const store = () => {
    const h = mkdtempSync(join(tmpdir(), "gc-pushsend-"));
    tmps.push(h);
    return new PushSubscriptionStore(h);
  };
  afterEach(() => {
    for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const sub = (n: number) => { const r = recipient(); return { endpoint: `https://push.example/${n}`, keys: { p256dh: r.p256dh, auth: r.auth } }; };

  test("delivers to every subscription and counts 2xx", async () => {
    const s = store();
    s.add("d1", sub(1), "t");
    s.add("d2", sub(2), "t");
    const send: SendFn = async () => ({ status: 201 });
    const out = await new PushSender({ store: s, vapid, send }).deliver({ title: "t", body: "b", kind: "approval" });
    expect(out).toEqual({ delivered: 2, pruned: 0, failed: 0 });
  });

  test("prunes a dead subscription on 404/410 and keeps the live one", async () => {
    const s = store();
    s.add("dead", { endpoint: "https://push.example/dead", keys: sub(1).keys }, "t");
    s.add("live", { endpoint: "https://push.example/live", keys: sub(2).keys }, "t");
    const pruned: string[] = [];
    const send: SendFn = async (url) => ({ status: url.endsWith("/dead") ? 410 : 201 });
    const out = await new PushSender({ store: s, vapid, send, onPruned: (id) => pruned.push(id) }).deliver({ title: "t", body: "b", kind: "error" });
    expect(out).toEqual({ delivered: 1, pruned: 1, failed: 0 });
    expect(pruned).toEqual(["dead"]);
    expect(s.count()).toBe(1);
    expect(s.list()[0].deviceId).toBe("live");
  });

  test("a network error on one target is counted, never thrown, and the fan-out continues", async () => {
    const s = store();
    s.add("d1", sub(1), "t");
    s.add("d2", sub(2), "t");
    let n = 0;
    const send: SendFn = async () => { if (n++ === 0) throw new Error("ECONNRESET"); return { status: 201 }; };
    const out = await new PushSender({ store: s, vapid, send }).deliver({ title: "t", body: "b", kind: "finished" });
    expect(out).toEqual({ delivered: 1, pruned: 0, failed: 1 });
  });

  test("zero subscriptions → no work, no crash", async () => {
    let called = false;
    const send: SendFn = async () => { called = true; return { status: 201 }; };
    const out = await new PushSender({ store: store(), vapid, send }).deliver({ title: "t", body: "b", kind: "question" });
    expect(out).toEqual({ delivered: 0, pruned: 0, failed: 0 });
    expect(called).toBe(false);
  });
});
