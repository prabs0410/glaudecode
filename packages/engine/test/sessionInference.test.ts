import { describe, expect, test } from "bun:test";
import { inferShellSession, type SessionCandidate } from "../src/sessionInference";

const NOW = 1_000_000_000_000; // fixed wall-clock for determinism
// helpers: a session that was touched `agoMs` before NOW
const at = (id: string, agoMs: number): SessionCandidate => ({ id, ts: NOW - agoMs });

describe("inferShellSession (#11 tiebreaker / #34 coverage)", () => {
  test("empty cwd → nothing docked, no lock, not ambiguous", () => {
    expect(inferShellSession([], { now: NOW })).toEqual({ sessionId: null, locked: null, ambiguous: false });
  });

  test("single live session → docks confidently (single-live tiebreaker)", () => {
    const r = inferShellSession([at("A", 5_000)], { now: NOW });
    expect(r).toEqual({ sessionId: "A", locked: "A", ambiguous: false });
  });

  test("two FRESH near-tie sessions, no prior lock → ambiguous, does NOT guess", () => {
    // both touched within the default 10s margin of each other → genuine tie
    const r = inferShellSession([at("A", 1_000), at("B", 3_000)], { now: NOW });
    expect(r.ambiguous).toBe(true);
    expect(r.sessionId).toBeNull(); // refuses to silently bind to the wrong one (the bug)
    expect(r.locked).toBeNull();
  });

  test("two live, newest leads runner-up by > margin → picks the clear winner, not ambiguous", () => {
    // A touched 1s ago, B touched 30s ago → 29s apart > 10s margin → A is decisively foreground
    const r = inferShellSession([at("A", 1_000), at("B", 30_000)], { now: NOW });
    expect(r).toEqual({ sessionId: "A", locked: "A", ambiguous: false });
  });

  test("stale sessions only (older than the live window) → nothing live, no dock", () => {
    const r = inferShellSession([at("A", 5 * 60_000), at("B", 10 * 60_000)], { now: NOW });
    expect(r).toEqual({ sessionId: null, locked: null, ambiguous: false });
  });

  test("locked session goes idle but is the only one → stays sticky (no flap to null)", () => {
    // A is now stale (3 min) but still listed; we already hold it → keep it docked.
    const r = inferShellSession([at("A", 3 * 60_000)], { now: NOW, locked: "A" });
    expect(r).toEqual({ sessionId: "A", locked: "A", ambiguous: false });
  });

  test("locked session disappears from the cwd entirely → drops the dock", () => {
    const r = inferShellSession([at("B", 60_000)], { now: NOW, locked: "A" });
    // A is gone; B is the only live one → switch to B (single-live, confident).
    expect(r).toEqual({ sessionId: "B", locked: "B", ambiguous: false });
  });

  test("a decisively-newer session takes over → switches the lock", () => {
    // We hold A (touched 40s ago); B just got touched 1s ago, 39s newer → user moved to B.
    const r = inferShellSession([at("A", 40_000), at("B", 1_000)], { now: NOW, locked: "A" });
    expect(r).toEqual({ sessionId: "B", locked: "B", ambiguous: false });
  });

  test("holding a live lock while a near-tie newcomer appears → KEEPS the lock, flags ambiguous (no flap)", () => {
    // We hold A (2s ago); B appears at 1s ago — within margin. Don't flap; keep A but surface the tie.
    const r = inferShellSession([at("A", 2_000), at("B", 1_000)], { now: NOW, locked: "A" });
    expect(r).toEqual({ sessionId: "A", locked: "A", ambiguous: true });
  });

  test("cwd change (caller resets locked to null) → resolves the NEW cwd, ignores the old lock", () => {
    // After a cd, the caller threads locked:null; only C is live in the new dir → dock C cleanly.
    const r = inferShellSession([at("C", 4_000)], { now: NOW, locked: null });
    expect(r).toEqual({ sessionId: "C", locked: "C", ambiguous: false });
  });

  test("custom liveWindow / margin are honoured", () => {
    // With a 1s live window, a 5s-old session isn't live → nothing docks.
    expect(inferShellSession([at("A", 5_000)], { now: NOW, liveWindowMs: 1_000 }).sessionId).toBeNull();
    // With a 1ms margin, two sessions 2s apart are no longer a tie → the newer wins confidently.
    const r = inferShellSession([at("A", 1_000), at("B", 3_000)], { now: NOW, marginMs: 1 });
    expect(r).toEqual({ sessionId: "A", locked: "A", ambiguous: false });
  });

  test("ignores malformed candidates without throwing", () => {
    const junk = [null, undefined, { ts: 5 }, at("A", 5_000)] as unknown as SessionCandidate[];
    const r = inferShellSession(junk, { now: NOW });
    expect(r).toEqual({ sessionId: "A", locked: "A", ambiguous: false });
  });
});
