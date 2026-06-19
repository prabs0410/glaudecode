import { describe, expect, test } from "bun:test";
import { EventLog } from "../src/eventLog";

function mkClock(start = 1_000) {
  let t = start;
  return { now: () => t, tick: (ms: number) => (t += ms) };
}

describe("EventLog — record + bounds", () => {
  test("record assigns a monotonic seq + an ISO timestamp", () => {
    const c = mkClock(0);
    const log = new EventLog(c.now);
    const a = log.record({ kind: "rpc", level: "info", msg: "rpc x" });
    c.tick(5);
    const b = log.record({ kind: "ws", level: "info", msg: "ws open" });
    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
    expect(typeof a.at).toBe("string");
    expect(b.at >= a.at).toBe(true);
  });

  test("the ring is bounded — oldest events drop past max", () => {
    const c = mkClock();
    const log = new EventLog(c.now, 3);
    for (let i = 0; i < 10; i++) log.record({ kind: "rpc", level: "info", msg: "m" + i });
    const all = log.list();
    expect(all.length).toBe(3);
    expect(all.map((e) => e.msg)).toEqual(["m7", "m8", "m9"]); // newest kept
    expect(log.size()).toBe(3);
  });
});

describe("EventLog — list filters", () => {
  const c = mkClock();
  const log = new EventLog(c.now, 100);
  log.record({ kind: "rpc", level: "info", msg: "rpc ok" });
  log.record({ kind: "ws", level: "warn", msg: "ws slow" });
  log.record({ kind: "rpc", level: "error", msg: "rpc fail" });
  log.record({ kind: "pair", level: "info", msg: "paired" });

  test("filters by kind", () => {
    expect(log.list({ kinds: ["rpc"] }).map((e) => e.msg)).toEqual(["rpc ok", "rpc fail"]);
  });
  test("filters by minimum level (warn → warn+error)", () => {
    expect(log.list({ level: "warn" }).map((e) => e.msg)).toEqual(["ws slow", "rpc fail"]);
  });
  test("sinceSeq returns only newer events (incremental polling)", () => {
    const seq2 = log.list()[1].seq;
    expect(log.list({ sinceSeq: seq2 }).map((e) => e.msg)).toEqual(["rpc fail", "paired"]);
  });
  test("limit keeps the most RECENT N after filtering", () => {
    expect(log.list({ limit: 2 }).map((e) => e.msg)).toEqual(["rpc fail", "paired"]);
  });
});

describe("EventLog — health helpers", () => {
  test("lastError returns the most recent error, or null", () => {
    const c = mkClock();
    const log = new EventLog(c.now);
    expect(log.lastError()).toBeNull();
    log.record({ kind: "rpc", level: "info", msg: "ok" });
    log.record({ kind: "engine", level: "error", msg: "boom", data: { where: "spawn" } });
    log.record({ kind: "rpc", level: "info", msg: "ok2" });
    expect(log.lastError()?.msg).toBe("boom");
  });

  test("countsByKind tallies events per kind", () => {
    const c = mkClock();
    const log = new EventLog(c.now);
    log.record({ kind: "rpc", level: "info", msg: "a" });
    log.record({ kind: "rpc", level: "info", msg: "b" });
    log.record({ kind: "ws", level: "info", msg: "c" });
    expect(log.countsByKind()).toEqual({ rpc: 2, ws: 1 });
  });
});

describe("EventLog — rpcMetrics (lightweight APM)", () => {
  test("aggregates per-method calls, errors, p50/p95/max from rpc events", () => {
    const c = mkClock();
    const log = new EventLog(c.now, 1000);
    // getSessionMessages: 10 calls 10..100ms, one error
    for (let i = 1; i <= 10; i++)
      log.record({ kind: "rpc", level: i === 10 ? "error" : "info", msg: "rpc", data: { method: "getSessionMessages", ms: i * 10, ok: i !== 10 } });
    // agentState: 2 fast calls
    log.record({ kind: "rpc", level: "info", msg: "rpc", data: { method: "agentState", ms: 2, ok: true } });
    log.record({ kind: "rpc", level: "info", msg: "rpc", data: { method: "agentState", ms: 4, ok: true } });
    const m = log.rpcMetrics();
    const gsm = m.find((x) => x.method === "getSessionMessages")!;
    expect(gsm.calls).toBe(10);
    expect(gsm.errors).toBe(1);
    expect(gsm.maxMs).toBe(100);
    expect(gsm.p50).toBeGreaterThan(0);
    expect(gsm.p95).toBeGreaterThanOrEqual(gsm.p50);
    expect(m[0].method).toBe("getSessionMessages"); // sorted by call volume desc
  });
});
