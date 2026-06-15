// The secure-defaults release gate (V5 Phase 7.3.2). This is the NAMED set of secure-default
// assertions the CI gate runs (server.test.ts + rpc.test.ts cover most of these in context too);
// deliberately breaking any one — defaulting a remote bind, removing the wildcard guard, leaving an
// RpcMethod unclassified, dropping a governance doc — turns this red, so a regression fails the build.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { startEngineServer } from "../src/server";
import { PairingService, genPairCode } from "../src/pairing";
import { LOCAL_ONLY_METHODS, METHODS, STEER_METHODS, TERMINAL_ONLY_METHODS, VIEW_METHODS } from "../src/rpc";

const REPO = join(import.meta.dir, "..", "..", ".."); // packages/engine/test → repo root

describe("secure-defaults release gate (V5 Phase 7.3.2)", () => {
  test("the engine binds localhost + remote is OFF by default", () => {
    const s = startEngineServer({ token: "gate" });
    try {
      expect(s.port).toBeGreaterThan(0);
      expect(s.remote.status().enabled).toBe(false);
    } finally {
      s.stop();
    }
  });

  test("remote.enable rejects wildcard interfaces", () => {
    const s = startEngineServer({ token: "gate" });
    try {
      for (const h of ["0.0.0.0", "::", "*"]) expect(() => s.remote.enable(h)).toThrow(/wildcard/);
    } finally {
      s.stop();
    }
  });

  test("every RpcMethod is classified in EXACTLY one scope tier (no silent steer default)", () => {
    const sets = [VIEW_METHODS, STEER_METHODS, TERMINAL_ONLY_METHODS, LOCAL_ONLY_METHODS];
    for (const m of METHODS) {
      expect({ method: m, tiers: sets.filter((s) => s.has(m)).length }).toEqual({ method: m, tiers: 1 });
    }
  });

  test("the `terminal` (RCE) scope is NOT a pairing default", () => {
    const svc = new PairingService({ now: () => 0, genCode: genPairCode, genToken: () => "t" });
    expect(svc.createPairCode().scope).not.toBe("terminal");
  });

  test("governance docs are present + name the RCE risk", () => {
    expect(existsSync(join(REPO, "SECURITY.md"))).toBe(true);
    const tm = join(REPO, "docs", "security", "threat-model.md");
    expect(existsSync(tm)).toBe(true);
    const body = readFileSync(tm, "utf8").toLowerCase().replace(/\s+/g, " "); // collapse line wraps
    expect(body).toContain("remote code execution");
    expect(body).toContain("shared-responsibility");
  });
});
