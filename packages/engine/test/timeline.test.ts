import { describe, expect, test } from "bun:test";
import { buildTimeline } from "../src/timeline";
import type { SessionMessage } from "../src/types";

function m(p: Partial<SessionMessage>): SessionMessage {
  return { id: "m", role: "assistant", blocks: [], ...p };
}

describe("buildTimeline", () => {
  test("orders thinking then tool entries", () => {
    const tl = buildTimeline([
      m({
        id: "a",
        role: "assistant",
        blocks: [
          { kind: "thinking", text: "let me check" },
          { kind: "tool_use", id: "t1", name: "Bash", input: { cmd: "ls" } },
        ],
      }),
    ]);
    expect(tl.map((e) => e.kind)).toEqual(["thinking", "tool"]);
    expect(tl[1]).toMatchObject({ kind: "tool", name: "Bash", status: "pending" });
  });

  test("pairs tool_use with its result for ok/error status", () => {
    const tl = buildTimeline([
      m({ id: "a", role: "assistant", blocks: [{ kind: "tool_use", id: "t1", name: "Read", input: {} }] }),
      m({ id: "b", role: "user", blocks: [{ kind: "tool_result", toolUseId: "t1", isError: false }] }),
      m({ id: "c", role: "assistant", blocks: [{ kind: "tool_use", id: "t2", name: "Bash", input: {} }] }),
      m({ id: "d", role: "user", blocks: [{ kind: "tool_result", toolUseId: "t2", isError: true }] }),
    ]);
    const tools = tl.filter((e) => e.kind === "tool") as Extract<typeof tl[number], { kind: "tool" }>[];
    expect(tools.map((t) => t.status)).toEqual(["ok", "error"]);
  });

  test("text blocks are not included", () => {
    const tl = buildTimeline([m({ blocks: [{ kind: "text", text: "hi" }] })]);
    expect(tl).toEqual([]);
  });

  test("tool_use without id falls back to a positional id and stays pending", () => {
    const tl = buildTimeline([m({ id: "z", blocks: [{ kind: "tool_use", name: "Glob", input: {} }] })]);
    expect(tl[0]).toMatchObject({ kind: "tool", id: "z:0", status: "pending" });
  });
});
