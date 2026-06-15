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
