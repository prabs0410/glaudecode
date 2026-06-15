import { describe, expect, test } from "bun:test";
import * as dFuzzy from "../src/fuzzy";
import * as eFuzzy from "../../engine/src/fuzzy";
import * as dOsc from "../src/osc";
import * as eOsc from "../../engine/src/osc";
import * as dKeys from "../src/keybindings";
import * as eKeys from "../../engine/src/keybindings";
import * as dNotify from "../src/notify";
import * as eNotify from "../../engine/src/notify";

// Drift guard (audit L9). The WebView CAN'T import the @glaudecode/engine package at runtime (it pulls
// the Node-only Agent SDK), so a handful of pure helpers are MIRRORED by hand in packages/desktop/src.
// These tests import BOTH the desktop mirror and the engine source and assert behavioral equality over
// a battery — so a one-sided edit (especially on the input path) can't silently diverge and ship green.
// (Component tests for the arm/kill/consent UI need a DOM runner — tracked as a follow-up.)
describe("desktop mirrors match the engine source (no drift)", () => {
  test("fuzzyScore + fuzzyRank", () => {
    const cases: Array<[string, string]> = [
      ["abc", "aXbXc"],
      ["", ""],
      ["xyz", "abc"],
      ["ls", "ls -la"],
      ["GC", "GlaudeCode"],
    ];
    for (const [q, t] of cases) expect(dFuzzy.fuzzyScore(q, t)).toBe(eFuzzy.fuzzyScore(q, t));
    // The desktop returns bare items; the engine returns {item, score} — by design. Compare the
    // RANKED ORDER (that's the shared behavior that must not drift).
    const items = ["alpha", "beta", "gamma", "GlaudeCode"];
    expect(dFuzzy.fuzzyRank("ga", items, (s) => s)).toEqual(
      eFuzzy.fuzzyRank("ga", items, (s) => s).map((r) => r.item),
    );
  });

  test("parseOsc133 + parseOsc7", () => {
    for (const p of ["D;0", "A", "C", "D;1;extra", "garbage", ""]) {
      expect(dOsc.parseOsc133(p)).toEqual(eOsc.parseOsc133(p));
    }
    for (const p of ["file://host/path", "file:///abs", "", "nonsense"]) {
      expect(dOsc.parseOsc7(p)).toBe(eOsc.parseOsc7(p));
    }
  });

  test("normalizeKeys", () => {
    for (const k of ["Ctrl+K", "cmd+shift+p", "  Mod+Enter  ", "alt+ArrowLeft"]) {
      expect(dKeys.normalizeKeys(k)).toBe(eKeys.normalizeKeys(k));
    }
  });

  test("coalesceNotifications", () => {
    const items = [
      { kind: "finished" as const, text: "a" },
      { kind: "finished" as const, text: "b" },
      { kind: "error" as const, text: "boom" },
      { kind: "approval" as const, text: "x" },
      { kind: "approval" as const, text: "y" },
      { kind: "approval" as const, text: "z" },
    ];
    expect(dNotify.coalesceNotifications(items)).toEqual(eNotify.coalesceNotifications(items));
  });
});
