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

export function chordFromEvent(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("mod");
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
