import { describe, expect, test } from "bun:test";
import { derivePromptState } from "../src/promptState";
import type { ContentBlock, SessionMessage } from "../src/types";

let seq = 0;
function msg(role: SessionMessage["role"], blocks: ContentBlock[]): SessionMessage {
  return { id: "m" + seq++, role, timestamp: new Date(0).toISOString(), blocks };
}
const ask = (id: string, questions: unknown): ContentBlock => ({ kind: "tool_use", id, name: "AskUserQuestion", input: { questions } });
const result = (toolUseId: string): ContentBlock => ({ kind: "tool_result", toolUseId, isError: false });

const NOW = 1_000_000;

describe("derivePromptState (V5 Phase 4)", () => {
  test("empty stream → not waiting, no question", () => {
    expect(derivePromptState([], NOW)).toEqual({ askUserQuestion: null, isWaiting: false });
  });

  test("an unanswered AskUserQuestion surfaces its first question + options", () => {
    const s = derivePromptState(
      [msg("assistant", [ask("t1", [{ question: "Pick a color?", options: [{ label: "Red", description: "warm" }, { label: "Blue" }], multiSelect: false }])])],
      NOW,
    );
    expect(s.isWaiting).toBe(true);
    expect(s.askUserQuestion).toEqual({
      question: "Pick a color?",
      options: [{ label: "Red", description: "warm" }, { label: "Blue", description: undefined }],
      multiSelect: false,
    });
  });

  test("an answered AskUserQuestion (has a tool_result) → not waiting", () => {
    const s = derivePromptState(
      [
        msg("assistant", [ask("t1", [{ question: "Pick?", options: [{ label: "A" }], multiSelect: false }])]),
        msg("user", [result("t1")]),
      ],
      NOW,
    );
    expect(s).toEqual({ askUserQuestion: null, isWaiting: false });
  });

  test("the most recent unanswered question wins over an older answered one", () => {
    const s = derivePromptState(
      [
        msg("assistant", [ask("t1", [{ question: "old?", options: [{ label: "x" }], multiSelect: false }])]),
        msg("user", [result("t1")]),
        msg("assistant", [ask("t2", [{ question: "new?", options: [{ label: "y" }], multiSelect: true }])]),
      ],
      NOW,
    );
    expect(s.isWaiting).toBe(true);
    expect(s.askUserQuestion?.question).toBe("new?");
    expect(s.askUserQuestion?.multiSelect).toBe(true);
  });

  test("ExitPlanMode is waiting but carries no option list", () => {
    const s = derivePromptState(
      [msg("assistant", [{ kind: "tool_use", id: "p1", name: "ExitPlanMode", input: { plan: "do things" } }])],
      NOW,
    );
    expect(s).toEqual({ askUserQuestion: null, isWaiting: true });
  });

  test("permissionMode is left undefined (not derivable from JSONL — phone omits the pill)", () => {
    const s = derivePromptState([msg("assistant", [ask("t1", [{ question: "q", options: [{ label: "a" }] }])])], NOW);
    expect(s.permissionMode).toBeUndefined();
  });

  test("malformed AskUserQuestion input → waiting with a null question (no throw)", () => {
    const s = derivePromptState([msg("assistant", [{ kind: "tool_use", id: "t1", name: "AskUserQuestion", input: { questions: [] } }])], NOW);
    expect(s.isWaiting).toBe(true);
    expect(s.askUserQuestion).toBeNull();
  });
});
