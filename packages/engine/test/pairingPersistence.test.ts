import { afterEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PairingService } from "../src/pairing";
import { DeviceStore } from "../src/deviceStore";

// C1: a paired phone must SURVIVE an engine respawn. A "respawn" = a NEW PairingService built from the
// SAME persisted signing key + the SAME on-disk device roster (a fresh DeviceStore over the same home).
const tmps: string[] = [];
function home() {
  const d = mkdtempSync(join(tmpdir(), "gc-pairpersist-"));
  tmps.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

let clock = 1_000_000;
const KEY = randomBytes(32);
function service(h: string) {
  // a stable signing key + a store over `h` — the two things that persist across a respawn
  let id = 0;
  return new PairingService({
    now: () => clock,
    genCode: () => "CODE" + id,
    genToken: () => "dev-" + ++id,
    signingKey: KEY,
    deviceStore: new DeviceStore(h),
  });
}

describe("paired tokens survive an engine respawn (C1)", () => {
  test("a token minted before a respawn still verifies after it", () => {
    const h = home();
    const a = service(h);
    const tok = a.redeem(a.createPairCode("steer").code, "iPhone")!.token;
    expect(a.verify(tok).ok).toBe(true);

    // --- respawn: a brand-new service over the same key + roster file ---
    const b = service(h);
    const v = b.verify(tok);
    expect(v.ok).toBe(true);
    expect(v.scope).toBe("steer");
    // the device is still on the roster (the Mac's device list isn't empty after a restart)
    expect(b.listDevices().some((d) => d.name === "iPhone")).toBe(true);
  });

  test("a revoke BEFORE a respawn stays revoked after it", () => {
    const h = home();
    const a = service(h);
    const r = a.redeem(a.createPairCode("terminal").code, "iPhone")!;
    expect(a.verify(r.token).ok).toBe(true);
    a.revoke(r.deviceId);
    expect(a.verify(r.token).ok).toBe(false);

    // respawn: the revocation persisted (the device is gone from the roster file)
    const b = service(h);
    expect(b.verify(r.token).ok).toBe(false);
    expect(b.verify(r.token).reason).toMatch(/revoked|unknown/);
  });

  test("WITHOUT persistence (no key/store injected) a token does NOT survive a respawn (pre-C1)", () => {
    const a = new PairingService({ now: () => clock, genCode: () => "C", genToken: () => "d1" });
    const tok = a.redeem(a.createPairCode("steer").code, "x")!.token;
    expect(a.verify(tok).ok).toBe(true);
    // a fresh service has a different ephemeral key + empty roster → the old token is rejected
    const b = new PairingService({ now: () => clock, genCode: () => "C", genToken: () => "d1" });
    expect(b.verify(tok).ok).toBe(false);
  });

  test("a token forged for another device is rejected even though the roster is persisted", () => {
    const h = home();
    const a = service(h);
    a.redeem(a.createPairCode("view").code, "x");
    // a token signed with the WRONG key (an attacker without the secret) never verifies
    const { signDeviceToken } = require("../src/tokenSigning");
    const forged = signDeviceToken("dev-1", "terminal", randomBytes(32));
    expect(a.verify(forged).ok).toBe(false);
  });
});
