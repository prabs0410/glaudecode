import { describe, expect, test } from "bun:test";
import { shouldPush, PUSH_KINDS } from "../src/pushPolicy";

describe("push notify policy (V6 Phase 3.4)", () => {
  test("buzzes on approval / question / finished / error", () => {
    for (const kind of ["approval", "question", "finished", "error"] as const) {
      expect(shouldPush(kind, "s1")).toBe(true);
    }
  });

  test("does NOT buzz on budget (a soft heads-up, not a come-back-now)", () => {
    expect(shouldPush("budget", "s1")).toBe(false);
    expect(PUSH_KINDS.has("budget")).toBe(false);
  });

  test("per-session mute suppresses a push for that session only", () => {
    const policy = { mutedSessions: new Set(["muted"]) };
    expect(shouldPush("approval", "muted", policy)).toBe(false);
    expect(shouldPush("approval", "other", policy)).toBe(true);
    expect(shouldPush("question", "muted", policy)).toBe(false);
  });

  test("a sessionless notification still fires if its kind is push-worthy", () => {
    expect(shouldPush("error", undefined, { mutedSessions: new Set(["x"]) })).toBe(true);
  });
});
