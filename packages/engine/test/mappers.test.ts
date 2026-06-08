// Pure unit tests for the SDK->domain mappers. Fully portable: no SDK calls, no
// real sessions on disk. These are the load-bearing correctness tests for V1-0.

import { describe, expect, test } from "bun:test";
import {
  mapBlocks,
  mapRole,
  mapSessionMessage,
  mapSessionSummary,
  mapUsage,
} from "../src/mappers";

describe("mapSessionSummary", () => {
  test("maps SDK session info to domain summary", () => {
    const out = mapSessionSummary({
      sessionId: "abc-123",
      customTitle: "Design auth flow",
      firstPrompt: "help me",
      summary: "a summary",
      gitBranch: "main",
      cwd: "/repo",
      tag: "wip",
      createdAt: "2026-06-01T00:00:00Z",
      lastModified: "2026-06-02T00:00:00Z",
      fileSize: 4096,
    });
    expect(out).toEqual({
      id: "abc-123",
      title: "Design auth flow",
      firstPrompt: "help me",
      summary: "a summary",
      gitBranch: "main",
      cwd: "/repo",
      tag: "wip",
      createdAt: "2026-06-01T00:00:00Z",
      lastModified: "2026-06-02T00:00:00Z",
      fileSize: 4096,
    });
  });

  test("tolerates missing optional fields", () => {
    const out = mapSessionSummary({ sessionId: "x" });
    expect(out.id).toBe("x");
    expect(out.title).toBeUndefined();
    expect(out.fileSize).toBeUndefined();
  });

  test("ignores non-numeric fileSize", () => {
    expect(mapSessionSummary({ sessionId: "x", fileSize: "big" }).fileSize).toBeUndefined();
  });
});

describe("mapRole", () => {
  test("passes through known roles", () => {
    expect(mapRole("user")).toBe("user");
    expect(mapRole("assistant")).toBe("assistant");
    expect(mapRole("system")).toBe("system");
  });
  test("maps unknown to 'other'", () => {
    expect(mapRole("attachment")).toBe("other");
    expect(mapRole(undefined)).toBe("other");
  });
});

describe("mapBlocks", () => {
  test("string content becomes a single text block", () => {
    expect(mapBlocks({ content: "hello" })).toEqual([{ kind: "text", text: "hello" }]);
  });
  test("empty string content becomes no blocks", () => {
    expect(mapBlocks({ content: "" })).toEqual([]);
  });
  test("extracts text, thinking, and tool_use blocks in order", () => {
    const blocks = mapBlocks({
      content: [
        { type: "text", text: "hi" },
        { type: "thinking", thinking: "hmm" },
        { type: "tool_use", name: "Read", input: { path: "a.ts" } },
        { type: "image", source: {} }, // ignored
      ],
    });
    expect(blocks).toEqual([
      { kind: "text", text: "hi" },
      { kind: "thinking", text: "hmm" },
      { kind: "tool_use", name: "Read", input: { path: "a.ts" } },
    ]);
  });
  test("non-array, non-string content yields no blocks", () => {
    expect(mapBlocks({ content: 42 })).toEqual([]);
    expect(mapBlocks({})).toEqual([]);
  });
});

describe("mapUsage", () => {
  test("maps token usage", () => {
    expect(
      mapUsage({ usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 5 } }),
    ).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 5,
      cacheCreationTokens: undefined,
    });
  });
  test("undefined when no usage present", () => {
    expect(mapUsage({})).toBeUndefined();
    expect(mapUsage({ usage: {} })).toBeUndefined();
  });
});

describe("mapSessionMessage", () => {
  test("maps a full assistant message", () => {
    const out = mapSessionMessage({
      uuid: "m1",
      parentUuid: "m0",
      type: "assistant",
      timestamp: "2026-06-01T00:00:00Z",
      message: {
        content: [{ type: "text", text: "done" }],
        usage: { input_tokens: 1, output_tokens: 2 },
      },
    });
    expect(out).toEqual({
      id: "m1",
      parentId: "m0",
      role: "assistant",
      timestamp: "2026-06-01T00:00:00Z",
      blocks: [{ kind: "text", text: "done" }],
      usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: undefined, cacheCreationTokens: undefined },
    });
  });

  test("falls back to parent_tool_use_id and tolerates missing message", () => {
    const out = mapSessionMessage({ uuid: "m2", parent_tool_use_id: "t1", type: "user" });
    expect(out.id).toBe("m2");
    expect(out.parentId).toBe("t1");
    expect(out.role).toBe("user");
    expect(out.blocks).toEqual([]);
    expect(out.usage).toBeUndefined();
  });
});
