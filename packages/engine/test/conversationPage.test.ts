import { describe, expect, test } from "bun:test";
import { CONVERSATION_HTML } from "../src/conversationPage";

// The conversation page (V6 primary mobile surface) is a TS template literal that serves an inline
// <script>. Inside that literal every backslash must be doubled (\\n, \\x1b, \\r) and a stray
// backtick / \" collapses the served JS and silently blanks the whole page. These guards lock the
// page's load-bearing invariants the same way termPage / cockpit are guarded.
describe("conversationPage served script parses (regression)", () => {
  // SAFE: the only input is our own compile-time CONVERSATION_HTML constant (never untrusted), and
  // `new Function(body)` is used purely to PARSE — the function is constructed, never called, so the
  // body never executes. Catches the whole class of template-literal escaping bugs.
  test("every inline <script> in the served chat page parses without a SyntaxError", () => {
    const scripts = [...CONVERSATION_HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const body of scripts) {
      if (!body.trim()) continue;
      // eslint-disable-next-line no-new-func
      expect(() => new Function(body)).not.toThrow();
    }
  });
});

describe("conversationPage token sourcing (audit H1)", () => {
  // The paired (terminal-scope) token must NEVER come from the URL query string — it lives in
  // sessionStorage only (the pair CODE may ride the URL fragment, scrubbed after read). This page
  // DOES read location.search, but only for the non-secret `pane` id — so the guard is narrower than
  // cockpit's: assert sessionStorage is the token source and nothing reads a `token` query param.
  test("token is read from sessionStorage, never a token query param", () => {
    expect(CONVERSATION_HTML).toContain('sessionStorage.getItem("ck.token")');
    expect(CONVERSATION_HTML).not.toMatch(/URLSearchParams\([^)]*\)\.get\(["']token["']\)/);
    expect(CONVERSATION_HTML).not.toMatch(/location\.search[^;]*token/);
  });
});

describe("conversationPage renders untrusted content safely", () => {
  // Every message / tool argument is attacker-influenced (a repo file path, a prompt). The page must
  // render it via textContent / DOM nodes only — never innerHTML — or a tool argument could inject
  // markup. Lock that: no innerHTML anywhere in the served page.
  test("the served page never uses innerHTML", () => {
    expect(CONVERSATION_HTML).not.toContain("innerHTML");
  });
});
