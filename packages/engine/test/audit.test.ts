import { describe, expect, test } from "bun:test";
import { AuditLog } from "../src/audit";

describe("AuditLog (V5 Phase 3.3.2)", () => {
  test("stamps a deterministic timestamp and lists events in order", () => {
    let t = 1_000_000;
    const log = new AuditLog(() => t);
    log.record({ type: "terminal-auth", deviceId: "d1", paneId: "p1" });
    t += 5000;
    log.record({ type: "disconnect", deviceId: "d1", reason: "revoked" });
    const out = log.list();
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ type: "terminal-auth", deviceId: "d1", paneId: "p1", at: new Date(1_000_000).toISOString() });
    expect(out[1]!.reason).toBe("revoked");
    expect(out[1]!.at).toBe(new Date(1_005_000).toISOString());
  });

  test("an input event records a byte COUNT, never the payload", () => {
    const log = new AuditLog(() => 0);
    log.record({ type: "input", paneId: "p1", bytes: 7 });
    const e = log.list()[0]!;
    expect(e.bytes).toBe(7);
    // the event shape has no field that could hold the keystroke bytes
    expect(Object.keys(e).sort()).toEqual(["at", "bytes", "paneId", "type"]);
  });

  test("bounded — oldest events drop past the cap", () => {
    const log = new AuditLog(() => 0, 3);
    for (let i = 0; i < 5; i++) log.record({ type: "input", paneId: "p" + i, bytes: 1 });
    const out = log.list();
    expect(out).toHaveLength(3);
    expect(out.map((e) => e.paneId)).toEqual(["p2", "p3", "p4"]); // p0,p1 dropped
  });
});
