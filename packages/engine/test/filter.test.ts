import { describe, expect, test } from "bun:test";
import { filterSessions } from "../src/filter";
import type { SessionSummary } from "../src/types";

const sessions: SessionSummary[] = [
  { id: "1", title: "Design auth flow", gitBranch: "main", firstPrompt: "build login" },
  { id: "2", title: "Fix billing bug", gitBranch: "fix/billing", tag: "urgent" },
  { id: "3", title: "Refactor parser", gitBranch: "main", summary: "cleanup the tokenizer" },
];

describe("filterSessions", () => {
  test("empty query returns all", () => {
    expect(filterSessions(sessions, "")).toHaveLength(3);
    expect(filterSessions(sessions, "   ")).toHaveLength(3);
  });

  test("matches on title (case-insensitive)", () => {
    expect(filterSessions(sessions, "AUTH").map((s) => s.id)).toEqual(["1"]);
  });

  test("matches on branch", () => {
    expect(filterSessions(sessions, "main").map((s) => s.id)).toEqual(["1", "3"]);
  });

  test("matches on tag, summary, firstPrompt", () => {
    expect(filterSessions(sessions, "urgent").map((s) => s.id)).toEqual(["2"]);
    expect(filterSessions(sessions, "tokenizer").map((s) => s.id)).toEqual(["3"]);
    expect(filterSessions(sessions, "login").map((s) => s.id)).toEqual(["1"]);
  });

  test("AND-of-terms across fields", () => {
    // "main" (branch) AND "parser" (title) -> only session 3
    expect(filterSessions(sessions, "main parser").map((s) => s.id)).toEqual(["3"]);
  });

  test("no match returns empty", () => {
    expect(filterSessions(sessions, "nonexistent")).toEqual([]);
  });
});
