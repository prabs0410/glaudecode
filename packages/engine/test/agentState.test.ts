import { describe, expect, test } from "bun:test";
import { deriveAgentState } from "../src/agentState";
import type { SessionMessage } from "../src/types";

const NOW = Date.parse("2026-06-09T12:00:00Z");
const at = (secsAgo: number) => new Date(NOW - secsAgo * 1000).toISOString();

function msg(partial: Partial<SessionMessage>): SessionMessage {
  return { id: "x", role: "assistant", blocks: [], ...partial };
}

describe("deriveAgentState", () => {
  test("empty → idle", () => {
    expect(deriveAgentState([], NOW).status).toBe("idle");
  });

  test("recent user prompt with no reply → thinking", () => {
    const state = deriveAgentState([msg({ role: "user", timestamp: at(2) })], NOW);
    expect(state.status).toBe("thinking");
  });

  test("recent assistant tool_use with no result → running-tool with name", () => {
    const state = deriveAgentState(
      [
        msg({ role: "user", timestamp: at(5) }),
        msg({
          role: "assistant",
          timestamp: at(2),
          model: "claude-opus-4-8",
          blocks: [
            { kind: "thinking", text: "..." },
            { kind: "tool_use", name: "Bash", input: {} },
          ],
        }),
      ],
      NOW,
    );
    expect(state.status).toBe("running-tool");
    expect(state.toolName).toBe("Bash");
    expect(state.model).toBe("claude-opus-4-8");
  });

  test("recent assistant text completion → idle", () => {
    const state = deriveAgentState(
      [msg({ role: "assistant", timestamp: at(2), blocks: [{ kind: "text", text: "done" }] })],
      NOW,
    );
    expect(state.status).toBe("idle");
  });

  test("stale activity → idle even if last was a tool_use", () => {
    const state = deriveAgentState(
      [msg({ role: "assistant", timestamp: at(120), blocks: [{ kind: "tool_use", name: "Read", input: {} }] })],
      NOW,
    );
    expect(state.status).toBe("idle");
  });

  test("reports the most recent assistant model", () => {
    const state = deriveAgentState(
      [
        msg({ role: "assistant", timestamp: at(20), model: "claude-haiku-4-5", blocks: [{ kind: "text", text: "a" }] }),
        msg({ role: "user", timestamp: at(2) }),
      ],
      NOW,
    );
    expect(state.model).toBe("claude-haiku-4-5");
    expect(state.status).toBe("thinking");
  });
});
