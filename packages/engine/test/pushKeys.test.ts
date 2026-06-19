import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateVapidKeys, loadOrCreateVapidKeys, vapidKeysFromJwk } from "../src/pushKeys";

const tmps: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "gc-vapid-"));
  tmps.push(d);
  return d;
};
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("vapidKeysFromJwk (pure derivation)", () => {
  test("assembles the uncompressed point 0x04‖X‖Y and keeps d as the private key", () => {
    const x = Buffer.alloc(32, 1);
    const y = Buffer.alloc(32, 2);
    const keys = vapidKeysFromJwk({ x: x.toString("base64url"), y: y.toString("base64url") }, { d: "ZA" });
    const point = Buffer.from(keys.publicKey, "base64url");
    expect(point.length).toBe(65);
    expect(point[0]).toBe(0x04);
    expect(point.subarray(1, 33).equals(x)).toBe(true);
    expect(point.subarray(33).equals(y)).toBe(true);
    expect(keys.privateKey).toBe("ZA");
  });

  test("rejects an incomplete JWK", () => {
    expect(() => vapidKeysFromJwk({ x: "AA" }, { d: "BB" })).toThrow(/incomplete/);
  });
});

describe("generateVapidKeys (EC P-256)", () => {
  test("produces a 65-byte uncompressed public point and a 32-byte private scalar", () => {
    const k = generateVapidKeys();
    const pub = Buffer.from(k.publicKey, "base64url");
    const priv = Buffer.from(k.privateKey, "base64url");
    expect(pub.length).toBe(65);
    expect(pub[0]).toBe(0x04);
    expect(priv.length).toBe(32);
  });

  test("two generations differ (real randomness, not a fixed key)", () => {
    expect(generateVapidKeys().publicKey).not.toBe(generateVapidKeys().publicKey);
  });
});

describe("loadOrCreateVapidKeys (persistence — stable across restarts)", () => {
  test("first run generates + persists; second run returns the IDENTICAL keys", () => {
    const path = join(tmp(), "vapid.json");
    const a = loadOrCreateVapidKeys(path);
    const b = loadOrCreateVapidKeys(path);
    expect(b).toEqual(a); // a browser subscription is bound to the public key — it must not change
    expect(JSON.parse(readFileSync(path, "utf8")).publicKey).toBe(a.publicKey);
  });

  test("writes the key file 0600 (not world-readable)", () => {
    const path = join(tmp(), "vapid.json");
    loadOrCreateVapidKeys(path);
    expect(statSync(path).mode & 0o077).toBe(0); // no group/other permission bits
  });

  test("regenerates on a corrupt file instead of throwing", () => {
    const path = join(tmp(), "vapid.json");
    writeFileSync(path, "{ not json");
    const k = loadOrCreateVapidKeys(path);
    expect(Buffer.from(k.publicKey, "base64url").length).toBe(65);
  });
});
