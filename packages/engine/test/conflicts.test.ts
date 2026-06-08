import { describe, expect, test } from "bun:test";
import { detectConflicts } from "../src/conflicts";
import type { ChangeEntry } from "../src/changes";

const ch = (path: string): ChangeEntry => ({ path, edits: 1, lastTool: "Edit" });

describe("detectConflicts", () => {
  test("flags a path edited by two sessions", () => {
    const out = detectConflicts([
      { sessionId: "s1", changes: [ch("/a.ts"), ch("/b.ts")] },
      { sessionId: "s2", changes: [ch("/b.ts"), ch("/c.ts")] },
    ]);
    expect(out).toEqual([{ path: "/b.ts", sessionIds: ["s1", "s2"] }]);
  });

  test("no conflict when paths are disjoint", () => {
    expect(
      detectConflicts([
        { sessionId: "s1", changes: [ch("/a.ts")] },
        { sessionId: "s2", changes: [ch("/b.ts")] },
      ]),
    ).toEqual([]);
  });

  test("three sessions on one path", () => {
    const out = detectConflicts([
      { sessionId: "s1", changes: [ch("/x")] },
      { sessionId: "s2", changes: [ch("/x")] },
      { sessionId: "s3", changes: [ch("/x")] },
    ]);
    expect(out[0].sessionIds.sort()).toEqual(["s1", "s2", "s3"]);
  });

  test("same session editing a file twice is not a conflict with itself", () => {
    expect(
      detectConflicts([{ sessionId: "s1", changes: [ch("/a"), { path: "/a", edits: 2, lastTool: "Edit" }] }]),
    ).toEqual([]);
  });

  test("results are sorted by path", () => {
    const out = detectConflicts([
      { sessionId: "s1", changes: [ch("/z"), ch("/a")] },
      { sessionId: "s2", changes: [ch("/z"), ch("/a")] },
    ]);
    expect(out.map((c) => c.path)).toEqual(["/a", "/z"]);
  });
});
