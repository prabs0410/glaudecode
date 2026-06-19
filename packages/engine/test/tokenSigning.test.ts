import { afterEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOrCreateSigningKey, signDeviceToken, verifyDeviceToken } from "../src/tokenSigning";

const KEY = randomBytes(32);
const tmps: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "gc-tksign-"));
  tmps.push(d);
  return d;
};
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("signDeviceToken / verifyDeviceToken", () => {
  test("round-trips deviceId + scope", () => {
    const tok = signDeviceToken("dev-abc123", "terminal", KEY);
    expect(verifyDeviceToken(tok, KEY)).toEqual({ deviceId: "dev-abc123", scope: "terminal" });
  });

  test("a token survives 'respawn' — the SAME persisted key verifies it later", () => {
    const tok = signDeviceToken("d1", "steer", KEY);
    // a fresh process with the same key (loaded from disk) still verifies it
    expect(verifyDeviceToken(tok, Buffer.from(KEY))).toEqual({ deviceId: "d1", scope: "steer" });
  });

  test("a tampered payload or signature is rejected", () => {
    const tok = signDeviceToken("d1", "view", KEY);
    const [p, s] = tok.split(".");
    // flip the payload (claim terminal) but keep the old signature → rejected
    const forgedPayload = Buffer.from("d1.terminal", "utf8").toString("base64url");
    expect(verifyDeviceToken(`${forgedPayload}.${s}`, KEY)).toBeNull();
    // flip a signature byte
    const badSig = Buffer.from(s!, "base64url");
    badSig[0]! ^= 0xff;
    expect(verifyDeviceToken(`${p}.${badSig.toString("base64url")}`, KEY)).toBeNull();
  });

  test("a token signed with a DIFFERENT key is rejected (forgery needs the secret)", () => {
    const tok = signDeviceToken("d1", "terminal", KEY);
    expect(verifyDeviceToken(tok, randomBytes(32))).toBeNull();
  });

  test("malformed tokens never throw", () => {
    for (const t of ["", "nodot", "a.b.c", "....", "x.", ".y"]) expect(verifyDeviceToken(t, KEY)).toBeNull();
    expect(verifyDeviceToken(undefined as unknown as string, KEY)).toBeNull();
  });
});

describe("loadOrCreateSigningKey (persistence)", () => {
  test("first run generates + persists 0600; second run returns the IDENTICAL key", () => {
    const path = join(tmp(), "token-key");
    const a = loadOrCreateSigningKey(path);
    const b = loadOrCreateSigningKey(path);
    expect(a.equals(b)).toBe(true);
    expect(a.length).toBe(32);
    expect(statSync(path).mode & 0o077).toBe(0);
    // a token minted before 'respawn' verifies with the reloaded key
    const tok = signDeviceToken("d1", "steer", a);
    expect(verifyDeviceToken(tok, b)).toEqual({ deviceId: "d1", scope: "steer" });
  });

  test("a corrupt/too-short key file is regenerated, not thrown", () => {
    const path = join(tmp(), "token-key");
    writeFileSync(path, "tiny");
    const k = loadOrCreateSigningKey(path);
    expect(k.length).toBe(32);
    expect(readFileSync(path, "utf8")).toBe(k.toString("base64url"));
  });
});
