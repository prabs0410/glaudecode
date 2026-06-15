// Pure phone-input helpers (V5 Phase 4). The cockpit terminal page (`termPage.ts`) is a self-
// contained HTML string the browser can't import from, so these helpers are MIRRORED verbatim in
// that inline script — and unit-tested here (the same pattern as desktop's fuzzy/osc/notify mirrors).

/** Wrap multi-line text in a bracketed-paste sequence so the PTY treats it as one paste — never
 *  auto-submitting each line (e.g. Claude Code reading a multi-line prompt). Single-line text is
 *  returned unchanged. Matches the desktop paste path in `TerminalPane.tsx`. */
export function wrapForPaste(text: string): string {
  // Strip any bracketed-paste markers already inside the text BEFORE wrapping. Without this, an
  // embedded \x1b[201~ ends the paste early and the PTY runs the remainder as live keystrokes —
  // paste-jacking from a saved prompt file (~/.glaudecode/prompts), the typed textarea, or the
  // desktop clipboard (audit H4). A SINGLE pass is bypassable: removing an inner marker can splice
  // its neighbours into a FRESH marker (e.g. "\x1b[20" + "\x1b[201~" + "1~" -> "\x1b[201~"), so we
  // loop to a FIXPOINT — after this, `clean` provably contains no 200~/201~ marker. The
  // byte-identical mirror in termPage.ts must match this exactly.
  let clean = text;
  let prev: string;
  do {
    prev = clean;
    clean = clean.replace(/\x1b\[20[01]~/g, "");
  } while (clean !== prev);
  return clean.includes("\n") ? `\x1b[200~${clean}\x1b[201~` : clean;
}

/** Map a printable key to its control byte (Ctrl-<key>), e.g. "c" -> "\x03", "[" -> "\x1b".
 *  Used by the phone key bar's sticky-Ctrl (V5 Phase 4 / Task 4.2.2). Non-letters pass through the
 *  same `& 0x1f` mask, which is correct for the @A–Z[\]^_ range; anything else returns "" (no-op). */
export function ctrlByte(ch: string): string {
  if (!ch || ch.length !== 1) return "";
  const code = ch.toUpperCase().charCodeAt(0);
  // Control codes exist for ASCII 0x40–0x5f ("@" .. "_"); the mask yields 0x00–0x1f.
  if (code >= 0x40 && code <= 0x5f) return String.fromCharCode(code & 0x1f);
  if (code >= 0x61 && code <= 0x7a) return String.fromCharCode(code & 0x1f); // a–z (already handled by toUpperCase, kept explicit)
  return "";
}
