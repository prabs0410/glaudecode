import { describe, expect, test } from "bun:test";
import { buildHandoffSummary } from "../src/handoff";
import type { SessionMessage } from "../src/types";

const msg = (role: SessionMessage["role"], text: string): SessionMessage => ({
  id: Math.random().toString(36).slice(2),
  role,
  blocks: text ? [{ kind: "text", text }] : [],
});

describe("buildHandoffSummary", () => {
  test("digests the last assistant message and includes the source title", () => {
    const out = buildHandoffSummary(
      [msg("user", "do the thing"), msg("assistant", "Done: added the parser."), msg("user", "thanks")],
      { fromTitle: "parser work" },
    );
    expect(out).toContain('handed off from session "parser work"');
    expect(out).toContain("Done: added the parser.");
    expect(out).toContain("Please continue this work from here.");
  });

  test("uses the most recent assistant message, not an earlier one", () => {
    const out = buildHandoffSummary([
      msg("assistant", "first answer"),
      msg("user", "more"),
      msg("assistant", "final answer"),
    ]);
    expect(out).toContain("final answer");
    expect(out).not.toContain("first answer");
  });

  test("falls back gracefully when there is no assistant output", () => {
    const out = buildHandoffSummary([msg("user", "hello")]);
    expect(out).toContain("no assistant output yet");
  });

  test("omits the title clause when none is given", () => {
    const out = buildHandoffSummary([msg("assistant", "x")]);
    expect(out).toContain("handed off from another session");
  });

  test("truncates long digests to maxChars with an ellipsis", () => {
    const long = "a".repeat(5000);
    const out = buildHandoffSummary([msg("assistant", long)], { maxChars: 100 });
    expect(out).toContain("…");
    // body line should be ~100 chars + ellipsis, not 5000
    expect(out.length).toBeLessThan(400);
  });

  test("strips terminal escapes so a digest can't break out of bracketed paste", () => {
    // An assistant echoed attacker content containing the end-paste sequence + a
    // malicious command. The digest must not carry the escape into the prompt.
    const evil = "ok\x1b[201~rm -rf ~\nmore\x07text";
    const out = buildHandoffSummary([msg("assistant", evil)], { fromTitle: "parser\x1b[201~" });
    // No ESC byte survives → the [201~ that remains is inert literal text, not an
    // escape, so it can't terminate the bracketed paste.
    expect(out).not.toContain("\x1b");
    expect(out).not.toContain("\x07");
    expect(out).toContain("rm -rf ~"); // the text survives as inert characters
    expect(out).toContain("parser"); // title's control bytes stripped, text kept
  });

  test("preserves tabs and newlines while stripping other control chars", () => {
    const out = buildHandoffSummary([msg("assistant", "a\tb\nc\x00d")], {});
    expect(out).toContain("a\tb\nc");
    expect(out).not.toContain("\x00");
  });

  test("skips empty assistant text blocks and joins multiple", () => {
    const m: SessionMessage = {
      id: "m",
      role: "assistant",
      blocks: [
        { kind: "thinking", text: "hmm" },
        { kind: "text", text: "line one" },
        { kind: "text", text: "line two" },
      ],
    };
    const out = buildHandoffSummary([m]);
    expect(out).toContain("line one\nline two");
    expect(out).not.toContain("hmm");
  });
});
