import { describe, expect, test } from "bun:test";
import { buildReplayBundle, redactText } from "../src/replay";
import type { SessionMessage } from "../src/types";

describe("redactText", () => {
  test("redacts common secret shapes", () => {
    expect(redactText("key sk-ABCDEFGHIJKLMNOP1234")).toContain("[REDACTED]");
    expect(redactText("aws AKIAIOSFODNN7EXAMPLE here")).toContain("[REDACTED]");
    expect(redactText("token ghp_0123456789abcdefghijABCDEFG")).toContain("[REDACTED]");
    expect(redactText("Authorization: Bearer abcdef0123456789ABCDEF")).toContain("[REDACTED]");
  });

  test("leaves ordinary text untouched", () => {
    const t = "just a normal sentence about worktrees and cost.";
    expect(redactText(t)).toBe(t);
  });
});

describe("buildReplayBundle", () => {
  const msgs: SessionMessage[] = [
    { id: "1", role: "user", blocks: [{ kind: "text", text: "use key sk-ABCDEFGHIJKLMNOP1234" }] },
    {
      id: "2",
      role: "assistant",
      blocks: [{ kind: "tool_use", id: "t", name: "Bash", input: { command: "curl -H 'Authorization: Bearer abcdef0123456789ABCDEF'" } }],
    },
  ];

  test("redacts message text and tool inputs by default", () => {
    const bundle = buildReplayBundle("s1", msgs, { title: "demo" });
    expect(bundle.version).toBe(1);
    expect(bundle.redacted).toBe(true);
    expect(bundle.meta.title).toBe("demo");
    const userText = (bundle.entries[0].blocks[0] as any).text;
    expect(userText).toContain("[REDACTED]");
    const cmd = (bundle.entries[1].blocks[0] as any).input.command;
    expect(cmd).toContain("[REDACTED]");
  });

  test("can skip redaction when explicitly disabled", () => {
    const bundle = buildReplayBundle("s1", msgs, {}, { redact: false });
    expect(bundle.redacted).toBe(false);
    expect((bundle.entries[0].blocks[0] as any).text).toContain("sk-ABCDEFGHIJKLMNOP1234");
  });

  test("does not mutate the input messages", () => {
    buildReplayBundle("s1", msgs);
    expect((msgs[0].blocks[0] as any).text).toContain("sk-ABCDEFGHIJKLMNOP1234");
  });
});
