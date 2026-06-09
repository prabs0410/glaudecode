// Keybindings (Epic F §3.2). A default keymap plus user overrides at
// ~/.glaudecode/keybindings.json. App actions are bound to chords like "mod+k" ("mod" =
// cmd/ctrl, cross-platform). We detect conflicts and protect terminal keys (a bare key
// with no modifier would capture typing meant for the PTY). The pure helpers (normalize,
// merge, conflicts, validate, chordFromEvent) are unit-tested; the store is small JSON I/O.

export interface Keybinding {
  command: string;
  keys: string;
}

export const DEFAULT_KEYBINDINGS: Keybinding[] = [
  { command: "palette.toggle", keys: "mod+k" },
  { command: "pane.new-shell", keys: "mod+t" },
  { command: "pane.next", keys: "mod+]" },
  { command: "pane.prev", keys: "mod+[" },
  { command: "pane.close", keys: "mod+w" },
  { command: "pane.split", keys: "mod+d" },
  { command: "search.reindex", keys: "mod+shift+r" },
  { command: "terminal.search", keys: "mod+f" },
  { command: "view.zoom-in", keys: "mod+=" },
  { command: "view.zoom-out", keys: "mod+-" },
  { command: "view.zoom-reset", keys: "mod+0" },
  { command: "view.toggle-sidebar", keys: "mod+b" },
  { command: "view.toggle-dock", keys: "mod+shift+b" },
  { command: "view.zen", keys: "mod+shift+enter" },
  { command: "pane.go-1", keys: "mod+1" },
  { command: "pane.go-2", keys: "mod+2" },
  { command: "pane.go-3", keys: "mod+3" },
  { command: "pane.go-4", keys: "mod+4" },
  { command: "pane.go-5", keys: "mod+5" },
  { command: "pane.go-6", keys: "mod+6" },
  { command: "pane.go-7", keys: "mod+7" },
  { command: "pane.go-8", keys: "mod+8" },
  { command: "pane.go-9", keys: "mod+9" },
];

const MOD_TOKENS = new Set(["mod", "cmd", "command", "meta", "ctrl", "control"]);

/** Canonical chord string: modifiers (mod, alt, shift) sorted, then the key. */
export function normalizeKeys(keys: string): string {
  const parts = keys
    .toLowerCase()
    .split("+")
    .map((s) => s.trim())
    .filter(Boolean);
  const mods = new Set<string>();
  let key = "";
  for (const p of parts) {
    if (MOD_TOKENS.has(p)) mods.add("mod");
    else if (p === "alt" || p === "option") mods.add("alt");
    else if (p === "shift") mods.add("shift");
    else key = p;
  }
  const order = ["mod", "alt", "shift"].filter((m) => mods.has(m));
  return [...order, key].filter(Boolean).join("+");
}

/** Apply user overrides (replace by command) onto the defaults. */
export function mergeKeymap(defaults: Keybinding[], overrides: Keybinding[]): Keybinding[] {
  const map = new Map(defaults.map((b) => [b.command, b.keys]));
  for (const o of overrides) map.set(o.command, o.keys);
  return [...map].map(([command, keys]) => ({ command, keys }));
}

/** Chords bound by more than one command. */
export function detectConflicts(keymap: Keybinding[]): Array<{ keys: string; commands: string[] }> {
  const byKeys = new Map<string, string[]>();
  for (const b of keymap) {
    const k = normalizeKeys(b.keys);
    const list = byKeys.get(k) ?? [];
    list.push(b.command);
    byKeys.set(k, list);
  }
  return [...byKeys]
    .filter(([, cmds]) => cmds.length > 1)
    .map(([keys, commands]) => ({ keys, commands }));
}

/** Reject bindings that would steal terminal input (no modifier) or are empty. */
export function validateKeys(keys: string): { ok: boolean; reason?: string } {
  const norm = normalizeKeys(keys);
  if (!norm) return { ok: false, reason: "empty keybinding" };
  const hasMod = norm.startsWith("mod") || norm.includes("alt");
  if (!hasMod) return { ok: false, reason: "needs a modifier (mod/alt) so it doesn't capture terminal keys" };
  return { ok: true };
}

export interface KeyEventLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/** Normalized chord for a key event ("mod" = meta or ctrl). */
export function chordFromEvent(e: KeyEventLike): string {
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("mod");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  parts.push(e.key);
  return normalizeKeys(parts.join("+"));
}

/** The command bound to this event, if any. */
export function matchEvent(e: KeyEventLike, keymap: Keybinding[]): string | null {
  const chord = chordFromEvent(e);
  for (const b of keymap) if (normalizeKeys(b.keys) === chord) return b.command;
  return null;
}

// ---------- store ----------

import { homedir } from "node:os";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export class KeybindingStore {
  constructor(private readonly home: string = homedir()) {}

  private path(): string {
    return join(this.home, ".glaudecode", "keybindings.json");
  }

  async readOverrides(): Promise<Keybinding[]> {
    try {
      const raw = await readFile(this.path(), "utf8");
      const parsed = raw.trim() ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e: any) {
      if (e?.code === "ENOENT") return [];
      throw e;
    }
  }

  /** The effective keymap (defaults + overrides) and any conflicts. */
  async effective(): Promise<{ bindings: Keybinding[]; conflicts: Array<{ keys: string; commands: string[] }> }> {
    const bindings = mergeKeymap(DEFAULT_KEYBINDINGS, await this.readOverrides());
    return { bindings, conflicts: detectConflicts(bindings) };
  }

  /** Persist (or clear, when keys is null) a single command's override. */
  async setOverride(command: string, keys: string | null): Promise<void> {
    const overrides = (await this.readOverrides()).filter((o) => o.command !== command);
    if (keys) overrides.push({ command, keys: normalizeKeys(keys) });
    await this.write(overrides);
  }

  async reset(): Promise<void> {
    await this.write([]);
  }

  private async write(overrides: Keybinding[]): Promise<void> {
    const path = this.path();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(overrides, null, 2) + "\n", "utf8");
  }
}
