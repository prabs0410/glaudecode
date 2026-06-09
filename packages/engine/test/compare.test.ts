import { describe, expect, test } from "bun:test";
import { compareSessions, type SessionView } from "../src/compare";

const view = (over: Partial<SessionView> = {}): SessionView => ({
  sessionId: "x",
  tools: [],
  files: [],
  usd: 0,
  tokens: 0,
  ...over,
});

describe("compareSessions", () => {
  test("splits tools and files into onlyA/onlyB/both, sorted", () => {
    const a = view({ sessionId: "a", tools: ["Bash", "Read", "Edit"], files: ["/x", "/y"] });
    const b = view({ sessionId: "b", tools: ["Read", "Write"], files: ["/y", "/z"] });
    const cmp = compareSessions(a, b);
    expect(cmp.tools).toEqual({ onlyA: ["Bash", "Edit"], onlyB: ["Write"], both: ["Read"] });
    expect(cmp.files).toEqual({ onlyA: ["/x"], onlyB: ["/z"], both: ["/y"] });
    expect(cmp.a).toBe("a");
    expect(cmp.b).toBe("b");
  });

  test("computes cost and token deltas as b − a", () => {
    const cmp = compareSessions(view({ usd: 1, tokens: 100 }), view({ usd: 3, tokens: 250 }));
    expect(cmp.costDeltaUsd).toBe(2);
    expect(cmp.tokenDelta).toBe(150);
  });

  test("identical sessions diff to all-both, zero deltas", () => {
    const a = view({ tools: ["Read"], files: ["/x"], usd: 2, tokens: 10 });
    const cmp = compareSessions(a, { ...a, sessionId: "b" });
    expect(cmp.tools.onlyA).toEqual([]);
    expect(cmp.tools.onlyB).toEqual([]);
    expect(cmp.tools.both).toEqual(["Read"]);
    expect(cmp.costDeltaUsd).toBe(0);
  });
});
