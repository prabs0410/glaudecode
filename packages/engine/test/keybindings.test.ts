import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_KEYBINDINGS,
  KeybindingStore,
  chordFromEvent,
  detectConflicts,
  matchEvent,
  mergeKeymap,
  normalizeKeys,
  validateKeys,
} from "../src/keybindings";

describe("normalizeKeys", () => {
  test("canonicalizes modifier aliases and order", () => {
    expect(normalizeKeys("Cmd+K")).toBe("mod+k");
    expect(normalizeKeys("ctrl+k")).toBe("mod+k");
    expect(normalizeKeys("shift+alt+mod+p")).toBe("mod+alt+shift+p");
  });
});

describe("mergeKeymap + detectConflicts", () => {
  test("overrides replace by command", () => {
    const merged = mergeKeymap(DEFAULT_KEYBINDINGS, [{ command: "palette.toggle", keys: "mod+p" }]);
    expect(merged.find((b) => b.command === "palette.toggle")?.keys).toBe("mod+p");
  });

  test("detects two commands on the same chord", () => {
    const conflicts = detectConflicts([
      { command: "a", keys: "mod+k" },
      { command: "b", keys: "Cmd+K" },
      { command: "c", keys: "mod+t" },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].commands.sort()).toEqual(["a", "b"]);
  });
});

describe("validateKeys", () => {
  test("rejects a bare key (would steal terminal input)", () => {
    expect(validateKeys("k").ok).toBe(false);
    expect(validateKeys("").ok).toBe(false);
  });
  test("accepts modified chords", () => {
    expect(validateKeys("mod+k").ok).toBe(true);
    expect(validateKeys("alt+enter").ok).toBe(true);
  });
});

describe("matchEvent", () => {
  const keymap = [{ command: "palette.toggle", keys: "mod+k" }];
  test("matches a meta/ctrl+k event", () => {
    expect(matchEvent({ key: "k", metaKey: true }, keymap)).toBe("palette.toggle");
    expect(matchEvent({ key: "k", ctrlKey: true }, keymap)).toBe("palette.toggle");
  });
  test("does not match a bare k", () => {
    expect(matchEvent({ key: "k" }, keymap)).toBeNull();
  });
  test("chordFromEvent builds a canonical chord", () => {
    expect(chordFromEvent({ key: "P", metaKey: true, shiftKey: true })).toBe("mod+shift+p");
  });
});

const tmpDirs: string[] = [];
afterAll(async () => {
  for (const d of tmpDirs) await rm(d, { recursive: true, force: true });
});

describe("KeybindingStore", () => {
  test("effective merges defaults; setOverride persists; reset clears", async () => {
    const home = await mkdtemp(join(tmpdir(), "glaude-keys-"));
    tmpDirs.push(home);
    const store = new KeybindingStore(home);

    const before = await store.effective();
    expect(before.bindings.find((b) => b.command === "palette.toggle")?.keys).toBe("mod+k");
    expect(before.conflicts).toEqual([]);

    await store.setOverride("palette.toggle", "Cmd+P");
    const after = await store.effective();
    expect(after.bindings.find((b) => b.command === "palette.toggle")?.keys).toBe("mod+p");

    await store.reset();
    expect((await store.readOverrides())).toEqual([]);
  });
});
