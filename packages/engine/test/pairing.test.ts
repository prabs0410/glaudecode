import { describe, expect, test } from "bun:test";
import { PairingService, type PairingDeps } from "../src/pairing";

// Deterministic clock + counters.
function harness(start = 1_000_000) {
  let t = start;
  let n = 0;
  const deps: PairingDeps = {
    now: () => t,
    genCode: () => `code-${n++}`,
    genToken: () => `tok-${n++}`,
    codeTtlMs: 1000,
    tokenTtlMs: 10_000,
    terminalTokenTtlMs: 2000, // short cap for the RCE scope (R8)
  };
  return { deps, advance: (ms: number) => (t += ms), svc: new PairingService(deps) };
}

describe("PairingService", () => {
  test("redeem a valid code yields a scoped token + device", () => {
    const { svc } = harness();
    const code = svc.createPairCode("steer");
    const tok = svc.redeem(code.code, "iPhone")!;
    expect(tok.scope).toBe("steer");
    expect(svc.verify(tok.token)).toMatchObject({ ok: true, scope: "steer" });
    expect(svc.listDevices()).toHaveLength(1);
    expect(svc.listDevices()[0].name).toBe("iPhone");
  });

  test("a code is single-use", () => {
    const { svc } = harness();
    const code = svc.createPairCode();
    expect(svc.redeem(code.code, "a")).not.toBeNull();
    expect(svc.redeem(code.code, "b")).toBeNull();
  });

  test("an expired code cannot be redeemed", () => {
    const { svc, advance } = harness();
    const code = svc.createPairCode();
    advance(2000); // past codeTtl (1000)
    expect(svc.redeem(code.code, "a")).toBeNull();
  });

  test("pairingLocked trips after a burst of failed redeems, then recovers (audit M3 backstop)", () => {
    const { svc, advance } = harness();
    expect(svc.pairingLocked()).toBe(false);
    // The IP-independent backstop: 20 failed (unknown-code) redeems within the window lock pairing,
    // regardless of source IP — so it still holds behind Tailscale Serve's shared 127.0.0.1 bucket.
    for (let i = 0; i < 20; i++) expect(svc.redeem("WRONG-" + i, "x")).toBeNull();
    expect(svc.pairingLocked()).toBe(true);
    advance(60_001); // failures age out of the 60s window
    expect(svc.pairingLocked()).toBe(false);
  });

  test("a successful redeem is never counted as a failure (audit M3)", () => {
    const { svc } = harness();
    for (let i = 0; i < 19; i++) svc.redeem("WRONG-" + i, "x"); // 19 failures, still under the cap
    const code = svc.createPairCode("view");
    expect(svc.redeem(code.code, "ok")).not.toBeNull();
    expect(svc.pairingLocked()).toBe(false); // the success added nothing to the failure window
  });

  test("an expired token fails verification", () => {
    const { svc, advance } = harness();
    const tok = svc.redeem(svc.createPairCode().code, "a")!;
    advance(11_000); // past tokenTtl (10000)
    expect(svc.verify(tok.token).ok).toBe(false);
  });

  test("requireScope: steer token satisfies view and steer; view token only view", () => {
    const { svc } = harness();
    const steer = svc.redeem(svc.createPairCode("steer").code, "a")!;
    const view = svc.redeem(svc.createPairCode("view").code, "b")!;
    expect(svc.requireScope(steer.token, "view").ok).toBe(true);
    expect(svc.requireScope(steer.token, "steer").ok).toBe(true);
    expect(svc.requireScope(view.token, "view").ok).toBe(true);
    expect(svc.requireScope(view.token, "steer").ok).toBe(false);
  });

  test("requireScope: terminal is the top of the ladder — NEVER implied by steer (V5 Phase 2)", () => {
    const { svc } = harness();
    const terminal = svc.redeem(svc.createPairCode("terminal").code, "t")!;
    const steer = svc.redeem(svc.createPairCode("steer").code, "s")!;
    const view = svc.redeem(svc.createPairCode("view").code, "v")!;
    expect(terminal.scope).toBe("terminal");
    // terminal satisfies everything (full control from the phone)
    expect(svc.requireScope(terminal.token, "view").ok).toBe(true);
    expect(svc.requireScope(terminal.token, "steer").ok).toBe(true);
    expect(svc.requireScope(terminal.token, "terminal").ok).toBe(true);
    // but NOTHING below terminal can reach it — this is the RCE boundary
    expect(svc.requireScope(steer.token, "terminal").ok).toBe(false);
    expect(svc.requireScope(view.token, "terminal").ok).toBe(false);
  });

  test("terminal tokens get a short TTL; an idle one dies while view/steer live on (R8 / Phase 3.3.3)", () => {
    const { svc, advance } = harness();
    const terminal = svc.redeem(svc.createPairCode("terminal").code, "t")!;
    const view = svc.redeem(svc.createPairCode("view").code, "v")!;
    advance(2500); // past the 2000 terminal cap, within the 10000 view TTL
    expect(svc.verify(terminal.token).ok).toBe(false); // idle terminal token expired
    expect(svc.verify(view.token).ok).toBe(true);
  });

  test("refresh rolls an active terminal token forward, but returns null once expired", () => {
    const { svc, advance } = harness();
    const terminal = svc.redeem(svc.createPairCode("terminal").code, "t")!;
    advance(1500);
    expect(svc.refresh(terminal.token)).not.toBeNull(); // still active → rolled forward to now+2000
    advance(1500); // 1500 since refresh (< 2000) → still alive
    expect(svc.verify(terminal.token).ok).toBe(true);
    advance(2500); // no refresh this window → past the cap
    expect(svc.refresh(terminal.token)).toBeNull();
    expect(svc.verify(terminal.token).ok).toBe(false);
  });

  test("revoke kills the device and its token immediately", () => {
    const { svc } = harness();
    const tok = svc.redeem(svc.createPairCode().code, "a")!;
    expect(svc.verify(tok.token).ok).toBe(true);
    expect(svc.revoke(tok.deviceId)).toBe(true);
    expect(svc.verify(tok.token).ok).toBe(false);
    expect(svc.listDevices()).toEqual([]);
    expect(svc.revoke(tok.deviceId)).toBe(false); // already gone
  });

  test("unknown token is rejected", () => {
    const { svc } = harness();
    expect(svc.verify("nope").ok).toBe(false);
  });
});
