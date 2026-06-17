import { describe, expect, test } from "bun:test";
import { ctrlByte, wrapForPaste } from "../src/termInput";
import { TERM_HTML } from "../src/termPage";

const E = "\x1b"; // ESC
/** A wrapped paste must carry NO end-marker except the trailing wrapper — otherwise the PTY ends
 *  the paste early and runs the remainder as live keystrokes (paste-jacking). */
function hasInteriorMarker(out: string): boolean {
  const body =
    out.startsWith(`${E}[200~`) && out.endsWith(`${E}[201~`) ? out.slice(6, -6) : out;
  return body.includes(`${E}[201~`) || body.includes(`${E}[200~`);
}

describe("wrapForPaste (V5 Phase 4)", () => {
  test("single-line text passes through unchanged", () => {
    expect(wrapForPaste("ls -la")).toBe("ls -la");
  });
  test("empty string passes through unchanged", () => {
    expect(wrapForPaste("")).toBe("");
  });
  test("multi-line text is wrapped in bracketed paste", () => {
    expect(wrapForPaste("line1\nline2")).toBe("\x1b[200~line1\nline2\x1b[201~");
  });
  test("trailing newline counts as multi-line", () => {
    expect(wrapForPaste("one\n")).toBe("\x1b[200~one\n\x1b[201~");
  });
});

describe("wrapForPaste paste-jacking guard (audit H4)", () => {
  test("an embedded end-marker cannot terminate the paste early", () => {
    // Single-line after the marker is stripped → passthrough, no breakout possible.
    expect(wrapForPaste(`evil${E}[201~rm -rf /`)).toBe("evilrm -rf /");
    // Multi-line keeps the wrap, but the interior marker is gone.
    expect(wrapForPaste(`a${E}[201~b\nc`)).toBe(`${E}[200~ab\nc${E}[201~`);
    expect(wrapForPaste(`${E}[200~x\ny${E}[201~`)).toBe(`${E}[200~x\ny${E}[201~`);
  });

  test("a SPLICE-reformed end-marker cannot survive (audit H4 fixpoint)", () => {
    // The adversarial bypass: removing the inner \x1b[201~ leaves "\x1b[20" + "1~" which fuse into a
    // FRESH \x1b[201~. A single pass leaks it; the fixpoint loop removes it. Output must have NO
    // interior marker and must NOT be the broken "...head\n\x1b[201~tail\x1b[201~".
    const out = wrapForPaste(`head\n${E}[20${E}[201~1~tail`);
    expect(hasInteriorMarker(out)).toBe(false);
    expect(out).toBe(`${E}[200~head\ntail${E}[201~`);
  });

  test("no input can produce an interior bracketed-paste marker", () => {
    const battery = [
      "ls -la",
      "",
      "line1\nline2",
      `evil${E}[201~payload`,
      `a${E}[200~b\nc${E}[201~d`,
      `${E}[201~\n${E}[201~`,
      `multi\nline\nwith${E}[201~break\nout`,
      // Splice-class: a removed marker fuses its neighbours into a new one (one or several layers).
      `head\n${E}[20${E}[201~1~tail`,
      `x\n${E}[2${E}[201~01~${E}[201~y`,
      `${E}[20${E}[20${E}[201~1~1~\nz`,
    ];
    for (const input of battery) expect(hasInteriorMarker(wrapForPaste(input))).toBe(false);
  });
});

// Drift guard: the cockpit term page (termPage.ts) can't import this module — it ships wrapForPaste
// as a verbatim mirror inside an inline <script>. Extract that mirror from the served HTML and prove
// it is byte-for-byte equivalent to the engine source over a battery (incl. the H4 scrub).
describe("termPage served script parses (regression)", () => {
  // A \" inside termPage's template literal collapses to "" in the served JS and breaks the WHOLE
  // inline script (blank page). Extract every inline <script> and assert it PARSES. SAFE: the only
  // input is our own compile-time TERM_HTML constant (never untrusted), and `new Function(body)` is
  // used purely to PARSE — the function is constructed, never called, so the body never executes.
  // Catches this entire class of escaping bug.
  test("every inline <script> in the served term page parses without a SyntaxError", () => {
    const scripts = [...TERM_HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const body of scripts) {
      if (!body.trim()) continue;
      // eslint-disable-next-line no-new-func
      expect(() => new Function(body)).not.toThrow();
    }
  });
});

describe("termPage touch-scroll is contained (V6 Phase 1.1)", () => {
  // Mobile drag must scroll xterm's buffer, never trigger the browser's pull-to-refresh / overscroll.
  test("html/body kill overscroll and #term contains the scroll chain", () => {
    expect(TERM_HTML).toContain("overscroll-behavior: none;"); // html/body — no pull-to-refresh
    expect(TERM_HTML).toContain("touch-action: pan-y;"); // #term — vertical drag scrolls the buffer
    expect(TERM_HTML).toContain(".xterm-viewport { overscroll-behavior: contain;");
    expect(TERM_HTML).not.toMatch(/#term \{[^}]*overflow: auto/); // the old escape-to-document scroller is gone
  });
});

describe("termPage soft-keyboard handling (V6 Phase 1.3)", () => {
  test("the viewport opts into interactive-widget=resizes-content", () => {
    expect(TERM_HTML).toContain("interactive-widget=resizes-content");
  });
});

describe("termPage fits to the viewport via FitAddon (V6 Phase 1.2)", () => {
  // The served page can't import; FitAddon is loaded via a <script src> like xterm.js, then used to
  // size the xterm grid to the phone viewport so output isn't cropped.
  test("the term page loads and uses the vendored FitAddon", () => {
    expect(TERM_HTML).toContain('<script src="/app/addon-fit.js">');
    expect(TERM_HTML).toContain("new FitAddon.FitAddon()");
    expect(TERM_HTML).toContain("fitAddon.fit()");
    expect(TERM_HTML).toContain("function doFit()");
  });
  test("the old guessed-cell-metrics fit path is gone", () => {
    expect(TERM_HTML).not.toContain("13 * 0.6"); // the hardcoded glyph-width guess
    expect(TERM_HTML).not.toContain("sizeOn"); // the manual take-control toggle is retired
  });
});

describe("termPage input bar actually shows (regression)", () => {
  // The #inputbar CSS default is `display: none`. updateInputUI used `bar.style.display = ""` to
  // "show" it — but "" reverts to the CSS rule (none), so the input bar NEVER appeared for a
  // terminal-scope device (the core "type from your phone" feature). It must set an explicit value.
  test("the input bar is shown with an explicit display, not '' (which stays hidden)", () => {
    expect(TERM_HTML).toContain("#inputbar { position: fixed"); // the rule whose default is display:none
    expect(TERM_HTML).not.toMatch(/bar\.style\.display = "";/); // the buggy show that stayed hidden
    expect(TERM_HTML).toContain('bar.style.display = "block"'); // explicit show — actually visible
  });
});

describe("termPage wrapForPaste mirrors the engine (audit H4 / no drift)", () => {
  // The mirror is a single line in the served HTML; greedy `.*` (no newline) captures the whole
  // function including the inner do-while block (a `[^}]*` stops at the do-block's first `}`).
  const m = TERM_HTML.match(/function wrapForPaste\(t\) \{.*\}/);
  test("the mirror is present in the served page", () => {
    expect(m).not.toBeNull();
  });
  test("the mirror matches the engine for every input", () => {
    // SAFE eval: the only input is our own compile-time TERM_HTML constant (authored in this repo),
    // never untrusted data. We eval the extracted function literal because the goal is to prove
    // BEHAVIORAL (byte-for-byte) equivalence of the served mirror, which a string compare can't.
    // eslint-disable-next-line no-eval
    const mirror = eval(`(${m![0]})`) as (t: string) => string;
    const battery = [
      "ls -la",
      "",
      "x\ny",
      `evil${E}[201~rm -rf /`,
      `a${E}[201~b\nc`,
      `${E}[200~x\ny${E}[201~`,
      `multi\nline${E}[201~break`,
    ];
    for (const input of battery) expect(mirror(input)).toBe(wrapForPaste(input));
  });
});

describe("ctrlByte (V5 Phase 4)", () => {
  test("Ctrl-C is 0x03 (from either case)", () => {
    expect(ctrlByte("c")).toBe("\x03");
    expect(ctrlByte("C")).toBe("\x03");
  });
  test("Ctrl-D / Ctrl-A / Ctrl-Z map correctly", () => {
    expect(ctrlByte("d")).toBe("\x04");
    expect(ctrlByte("a")).toBe("\x01");
    expect(ctrlByte("z")).toBe("\x1a");
  });
  test("Ctrl-[ is ESC (0x1b)", () => {
    expect(ctrlByte("[")).toBe("\x1b");
  });
  test("non-mappable / empty / multi-char inputs return empty", () => {
    expect(ctrlByte("")).toBe("");
    expect(ctrlByte("ab")).toBe("");
    expect(ctrlByte("1")).toBe(""); // digits have no control code
  });
});
