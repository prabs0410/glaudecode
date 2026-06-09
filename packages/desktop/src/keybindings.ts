// Frontend mirror of @glaudecode/engine's keybinding matching (verified by that package's
// tests). Kept in sync deliberately so the WebView can match keydowns without importing the
// Node-only engine.

export interface Keybinding {
  command: string;
  keys: string;
}

const MOD_TOKENS = new Set(["mod", "cmd", "command", "meta", "ctrl", "control"]);

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

// "mod" is the platform's APP modifier: Cmd on macOS, Ctrl elsewhere. Crucially, on macOS
// Ctrl is NOT an app modifier — Ctrl-key combos (Ctrl-C/W/K/F/…) must reach the terminal,
// so they don't map to "mod" and won't match app bindings.
const IS_MAC = typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent || "");

export function chordFromEvent(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (IS_MAC ? e.metaKey : e.ctrlKey) parts.push("mod");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  parts.push(e.key);
  return normalizeKeys(parts.join("+"));
}

export function matchEvent(e: KeyboardEvent, keymap: Keybinding[]): string | null {
  const chord = chordFromEvent(e);
  for (const b of keymap) if (normalizeKeys(b.keys) === chord) return b.command;
  return null;
}
