import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { wrapForPaste, moveToOptionKeys } from "../src/termInput";
import { filterSessions } from "../src/filter";
import { chordFromEvent } from "../src/keybindings";
import { TERM_HTML } from "../src/termPage";
import { CONVERSATION_HTML } from "../src/conversationPage";

// Mirror-drift battery (audit #26/#27). A handful of pure, security-relevant helpers are MIRRORED by
// hand because the served phone pages (termPage/conversationPage) are inline-<script> strings the
// browser can't import, and the desktop WebView can't import @glaudecode/engine (it pulls the Node-only
// SDK). The existing desktop test/mirror-drift.test.ts pins fuzzy/osc/keybindings/notify — but it (a)
// runs only under desktop `bun test`, NOT the `bun run verify` gate, and (b) misses the input-path
// matchers. This battery lives in the ENGINE suite (which the gate DOES run) and guards the rest by
// reading the other copies as source text — so a one-sided edit to the paste-jacking scrub or the
// keybinding matcher can't ship green.

const DESKTOP_SRC = join(import.meta.dir, "..", "..", "desktop", "src");
const readDesktop = (f: string) => readFileSync(join(DESKTOP_SRC, f), "utf8");

/** Extract a function's full source (sig … matching close brace) from a blob of text. Brace-matching;
 *  safe for these helpers because none contain a `{`/`}` inside a string or regex literal. */
function extractFn(src: string, sig: string): string {
  const start = src.indexOf(sig);
  if (start < 0) throw new Error(`not found: ${sig}`);
  const open = src.indexOf("{", start);
  let depth = 0;
  let i = open;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) {
      i++;
      break;
    }
  }
  return src.slice(start, i);
}

/** Normalise source for byte-identity comparison: drop comments, collapse all whitespace. (None of the
 *  compared helpers contain `//` or `/* *​/` inside a string/regex, so this is safe for them.) */
function norm(s: string): string {
  return s
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, "")
    .trim();
}

/** Compile an extracted function-source string into a callable (the JS parser interprets `\x1b`/`\n`
 *  escapes exactly as the browser would for the served inline copies). Strips TS type annotations. */
function compile(fnSrc: string): (t: string) => string {
  const js = fnSrc.replace(/:\s*string/g, "");
  return new Function("return (" + js + ")")() as (t: string) => string;
}

describe("mirror drift — filterSessions (#27)", () => {
  test("engine and desktop copies are byte-identical", () => {
    const eng = extractFn(readFileSync(join(import.meta.dir, "..", "src", "filter.ts"), "utf8"), "export function filterSessions");
    const desk = extractFn(readDesktop("engine.ts"), "export function filterSessions");
    expect(norm(desk)).toBe(norm(eng));
  });

  test("behaves as specified (multi-term AND, case-insensitive, all haystack fields)", () => {
    const sessions = [
      { id: "1", title: "Fix login", firstPrompt: "auth bug", gitBranch: "feat/auth", cwd: "/r/app" },
      { id: "2", title: "Docs", summary: "update README", tag: "chore" },
      { id: "3", title: "Login retry", firstPrompt: "AUTH flow" },
    ] as any[];
    const ids = (q: string) => filterSessions(sessions, q).map((s) => s.id);
    expect(ids("")).toEqual(["1", "2", "3"]); // empty → all
    expect(ids("   ")).toEqual(["1", "2", "3"]); // whitespace → all
    expect(ids("login")).toEqual(["1", "3"]); // case-insensitive title/prompt
    expect(ids("AUTH")).toEqual(["1", "3"]); // matches "auth bug" + "AUTH flow"
    expect(ids("feat/auth")).toEqual(["1"]); // gitBranch field
    expect(ids("docs chore")).toEqual(["2"]); // multi-term AND across title + tag
    expect(ids("login auth")).toEqual(["1", "3"]); // both terms must hit
    expect(ids("nope")).toEqual([]);
  });
});

describe("mirror drift — chordFromEvent input matcher (#26)", () => {
  test("differs ONLY by the two intentional divergences; the rest is byte-identical", () => {
    const eng = norm(extractFn(readFileSync(join(import.meta.dir, "..", "src", "keybindings.ts"), "utf8"), "export function chordFromEvent"));
    const desk = norm(extractFn(readDesktop("keybindings.ts"), "export function chordFromEvent"));
    // TWO deliberate divergences, pinned exactly so a change to either is a conscious edit:
    //  1. the param type — engine uses a structural KeyEventLike; desktop uses the DOM KeyboardEvent.
    //  2. the mod key — engine treats meta-or-ctrl as "mod" (host-agnostic); desktop is platform-aware
    //     (Cmd on macOS, Ctrl elsewhere).
    const engMod = 'if(e.metaKey||e.ctrlKey)parts.push("mod");';
    const deskMod = 'if(IS_MAC?e.metaKey:e.ctrlKey)parts.push("mod");';
    expect(eng).toContain("(e:KeyEventLike)");
    expect(desk).toContain("(e:KeyboardEvent)");
    expect(eng).toContain(engMod);
    expect(desk).toContain(deskMod);
    // …then assert EVERYTHING ELSE (alt/shift/key ordering + normalizeKeys) is identical, so an
    // unintended one-sided edit anywhere else in the matcher fails the build.
    const canon = (s: string) => s.replace(/\(e:Key\w+\)/, "(e:EV)").replace(engMod, "MOD").replace(deskMod, "MOD");
    expect(canon(desk)).toBe(canon(eng));
  });

  test("the engine matcher is exercised (alt/shift/key ordering through normalizeKeys)", () => {
    expect(chordFromEvent({ key: "k", metaKey: true } as any)).toBe("mod+k");
    expect(chordFromEvent({ key: "ArrowLeft", altKey: true, shiftKey: true } as any)).toBe("alt+shift+arrowleft");
    expect(chordFromEvent({ key: "Enter", ctrlKey: true } as any)).toBe("mod+enter");
  });
});

describe("mirror drift — the four paste-jacking scrubs (#27, audit H4)", () => {
  // Canonical (termInput) + the two served-page inline copies + the desktop terminal copy. The three
  // "wrap" copies share a contract (strip-to-fixpoint, then bracket-wrap iff multi-line); the desktop
  // scrubPasteMarkers strips only (its call site always wraps). All FOUR must remove EVERY interior
  // bracketed-paste marker so a copied \x1b[201~ can't break out of the wrapped paste and run as keys.
  const termPageWrap = compile(extractFn(TERM_HTML, "function wrapForPaste"));
  const convWrap = compile(extractFn(CONVERSATION_HTML, "function wrapPaste"));
  const desktopScrub = compile(extractFn(readDesktop("TerminalPane.tsx"), "function scrubPasteMarkers"));
  const ESC = "\x1b";
  const M0 = `${ESC}[200~`;
  const M1 = `${ESC}[201~`;

  /** True if `out` still contains a bracketed-paste marker AFTER removing at most one legit outer
   *  wrapper pair — i.e. an interior marker survived (the security failure). */
  function hasInteriorMarker(out: string): boolean {
    let s = out;
    if (s.startsWith(M0) && s.endsWith(M1)) s = s.slice(M0.length, s.length - M1.length);
    return /\x1b\[20[01]~/.test(s);
  }

  const battery: string[] = [
    "hello",
    "line1\nline2",
    `before${M1}after`,
    `${M0}x${M1}`,
    // splice-bypass: removing the inner marker must not let the neighbours re-form a fresh one
    `${ESC}[20${M1}1~`,
    `${ESC}[2${ESC}[200~00~`,
    `a${M1}${M1}b`,
    `${M1}${M0}${M1}`,
    "plain multi\nline\nwith\ttabs",
  ];
  // deterministic pseudo-random fuzz (no Math.random — keep tests reproducible)
  const frags = ["", "x", "\n", M0, M1, `${ESC}[20`, "1~", `${ESC}[2`, "00~"];
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let n = 0; n < 200; n++) {
    let s = "";
    const len = 2 + Math.floor(rnd() * 8);
    for (let k = 0; k < len; k++) s += frags[Math.floor(rnd() * frags.length)];
    battery.push(s);
  }

  test("the canonical scrub leaves no interior marker (fixpoint, not single-pass)", () => {
    for (const t of battery) expect(hasInteriorMarker(wrapForPaste(t))).toBe(false);
  });

  test("all three wrap copies produce output IDENTICAL to the canonical", () => {
    for (const t of battery) {
      const want = wrapForPaste(t);
      expect(termPageWrap(t)).toBe(want);
      expect(convWrap(t)).toBe(want);
    }
  });

  test("the desktop strip-only copy removes every marker too (its call site wraps)", () => {
    for (const t of battery) {
      const stripped = desktopScrub(t);
      expect(/\x1b\[20[01]~/.test(stripped)).toBe(false);
      // and wrapping it the way the call site does yields no interior marker
      expect(hasInteriorMarker(`${M0}${stripped}${M1}`)).toBe(false);
    }
  });

  test("every copy uses a FIXPOINT loop, not a single replace (the H4-fix2 regression guard)", () => {
    const fixpoint = /do\s*\{[\s\S]*?\.replace\([\s\S]*?20\[01\]~[\s\S]*?\}\s*while/;
    expect(extractFn(TERM_HTML, "function wrapForPaste")).toMatch(fixpoint);
    expect(extractFn(CONVERSATION_HTML, "function wrapPaste")).toMatch(fixpoint);
    expect(extractFn(readDesktop("TerminalPane.tsx"), "function scrubPasteMarkers")).toMatch(fixpoint);
    expect(extractFn(readFileSync(join(import.meta.dir, "..", "src", "termInput.ts"), "utf8"), "export function wrapForPaste")).toMatch(fixpoint);
  });
});

describe("served-page option selection is EXECUTED, not just present (#21, audit BL-3)", () => {
  // The "wrong option-index ships green" gap: both phone pages compute the absolute key sequence to
  // land on AskUserQuestion option `i` of `n` — conversationPage as a `moveTo(i)` closure, termPage as
  // an inline pair of for-loops — but NOTHING executed that logic in a test, so a drift from the
  // canonical moveToOptionKeys (e.g. back to the old "down × i from row 0", which silently submits the
  // WRONG option — Allow vs Deny) would pass. This extracts the actual served logic and RUNS it.

  /** Pull the two arrow-building loops the served page uses (tolerant of spacing + the accumulator
   *  name `s`/`seq`) and compile them into a callable (n, i) → key sequence. The JS parser interprets
   *  the `\x1b` text exactly as the browser would. */
  function extractSelectionKeys(html: string): (n: number, i: number) => string {
    const re = /for\s*\(\s*var u\s*=\s*0;\s*u\s*<\s*n;\s*u\+\+\s*\)\s*(\w+)\s*\+=\s*"\\x1b\[A";\s*for\s*\(\s*var d\s*=\s*0;\s*d\s*<\s*i;\s*d\+\+\s*\)\s*\1\s*\+=\s*"\\x1b\[B";/;
    const m = html.match(re);
    if (!m) throw new Error("absolute-selection loops not found in served page");
    const acc = m[1];
    return new Function("n", "i", `var ${acc}=""; ${m[0]} return ${acc};`) as (n: number, i: number) => string;
  }

  const convSelect = extractSelectionKeys(CONVERSATION_HTML);
  const termSelect = extractSelectionKeys(TERM_HTML);

  test("both pages' selection sequences MATCH the canonical moveToOptionKeys over a battery", () => {
    const cases: Array<[number, number]> = [
      [1, 0], [2, 0], [2, 1], [3, 0], [3, 1], [3, 2], [4, 1], [5, 4], [8, 7],
    ];
    for (const [n, i] of cases) {
      const want = moveToOptionKeys(n, i); // up × n (pin to top, clamps) then down × i
      expect(convSelect(n, i)).toBe(want);
      expect(termSelect(n, i)).toBe(want);
    }
  });

  test("the served selection pins to the TOP first (up × n) — position-independent, never row-0-relative", () => {
    // The whole BL-3 fix: lead with up × n so the count is exact regardless of any pre-highlight.
    const up = "\x1b[A";
    expect(convSelect(3, 2).startsWith(up.repeat(3))).toBe(true);
    expect(termSelect(3, 2).startsWith(up.repeat(3))).toBe(true);
    // selecting option 0 is ALL ups, no downs (never moves below the top)
    expect(convSelect(4, 0)).toBe(up.repeat(4));
    expect(termSelect(4, 0)).toBe(up.repeat(4));
  });

  test("the submit/​toggle bytes are correct in source — single=Enter, multi=Space-toggle + one Confirm Enter", () => {
    // Guards the OTHER half of BL-3 (the old bug sent a bare Enter per option, submitting early). A
    // single-select option appends \r; a multiSelect option appends a space (toggle); the Confirm sends \r.
    // conversationPage (named moveTo): single appends \r, multi appends a space.
    expect(CONVERSATION_HTML).toContain('moveTo(i)+"\\r"'); // single-select submit
    expect(CONVERSATION_HTML).toContain('moveTo(i)+" "'); // multiSelect toggle
    // termPage (inline seq): the single block submits seq + \r; the multi block toggles with a space.
    expect(TERM_HTML).toMatch(/seq\s*\+\s*"\\r"/); // single-select submit
    expect(TERM_HTML).toMatch(/seq\s*\+\s*" "/); // multiSelect toggle
  });
});
