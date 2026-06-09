import { describe, expect, test } from "bun:test";
import { buildResumeBriefing } from "../src/resume";
import type { SessionMessage } from "../src/types";

const u = (text: string): SessionMessage => ({ id: Math.random().toString(36).slice(2), role: "user", blocks: [{ kind: "text", text }] });
const a = (text: string): SessionMessage => ({ id: Math.random().toString(36).slice(2), role: "assistant", blocks: [{ kind: "text", text }] });

describe("buildResumeBriefing", () => {
  test("prefers the stored summary for the recap", () => {
    const out = buildResumeBriefing([u("hi"), a("hello")], { summary: "Set up the parser" });
    expect(out.recap).toBe("Set up the parser");
  });

  test("builds a recap from the last turns when no summary", () => {
    const out = buildResumeBriefing([u("add tests"), a("added 5 tests")]);
    expect(out.recap).toContain("add tests");
    expect(out.recap).toContain("added 5 tests");
  });

  test("suggests resuming when the agent hadn't replied", () => {
    const out = buildResumeBriefing([a("ok"), u("now do X")]);
    expect(out.suggestedNext).toMatch(/hadn't replied/);
  });

  test("flags an in-progress tool call", () => {
    const out = buildResumeBriefing([
      u("run it"),
      { id: "m", role: "assistant", blocks: [{ kind: "tool_use", id: "t1", name: "Bash", input: {} }] },
    ]);
    expect(out.suggestedNext).toMatch(/tool call/);
  });

  test("suggests reviewing changed files when idle with changes", () => {
    const out = buildResumeBriefing([u("edit"), a("done")], { changedFiles: 3 });
    expect(out.suggestedNext).toMatch(/3 changed files/);
  });

  test("handles an empty session", () => {
    const out = buildResumeBriefing([]);
    expect(out.recap).toMatch(/No activity/);
    expect(out.suggestedNext).toMatch(/Send a prompt/);
  });
});
