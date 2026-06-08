import { describe, expect, test } from "bun:test";
import { latestUserPrompt, suggestModel } from "../src/modelSuggestion";
import type { SessionMessage } from "../src/types";

describe("suggestModel", () => {
  test("suggests Haiku for a short mechanical task", () => {
    expect(suggestModel("fix a typo in the README").suggest).toBe("haiku");
    expect(suggestModel("rename this variable").suggest).toBe("haiku");
  });

  test("suggests Haiku for a very short task", () => {
    expect(suggestModel("add a license header").suggest).toBe("haiku");
  });

  test("does not suggest for clearly complex work", () => {
    expect(suggestModel("refactor the auth architecture for performance").suggest).toBeNull();
    expect(suggestModel("debug why the race condition happens").suggest).toBeNull();
  });

  test("does not suggest when already on Haiku", () => {
    expect(suggestModel("fix a typo", { currentModel: "claude-haiku-4-5" }).suggest).toBeNull();
  });

  test("does not suggest for a long trivial-sounding-but-big prompt", () => {
    const long = "rename ".repeat(40); // > 140 chars
    expect(suggestModel(long).suggest).toBeNull();
  });

  test("no suggestion for an empty prompt", () => {
    expect(suggestModel("").suggest).toBeNull();
  });
});

describe("latestUserPrompt", () => {
  test("returns the most recent user text", () => {
    const msgs: SessionMessage[] = [
      { id: "1", role: "user", blocks: [{ kind: "text", text: "first" }] },
      { id: "2", role: "assistant", blocks: [{ kind: "text", text: "reply" }] },
      { id: "3", role: "user", blocks: [{ kind: "text", text: "second" }] },
    ];
    expect(latestUserPrompt(msgs)).toBe("second");
  });

  test("empty when there is no user message", () => {
    expect(latestUserPrompt([{ id: "1", role: "assistant", blocks: [] }])).toBe("");
  });
});
