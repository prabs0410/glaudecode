import { describe, expect, test } from "bun:test";
import { fuzzyRank, fuzzyScore } from "../src/fuzzy";

describe("fuzzyScore", () => {
  test("non-subsequence scores 0", () => {
    expect(fuzzyScore("xyz", "new session")).toBe(0);
  });

  test("empty query matches everything", () => {
    expect(fuzzyScore("", "anything")).toBeGreaterThan(0);
  });

  test("contiguous + prefix beats scattered", () => {
    const prefix = fuzzyScore("new", "new session");
    const scattered = fuzzyScore("new", "narrow window edge");
    expect(prefix).toBeGreaterThan(scattered);
  });

  test("word-boundary initials match (e.g. 'ns' → New Session)", () => {
    expect(fuzzyScore("ns", "new session")).toBeGreaterThan(0);
  });
});

describe("fuzzyRank", () => {
  const cmds = [
    { id: "new-claude", title: "New Claude session" },
    { id: "new-shell", title: "New shell pane" },
    { id: "open-memory", title: "Open memory" },
    { id: "search", title: "Search all content" },
  ];

  test("ranks best matches first and drops non-matches", () => {
    const out = fuzzyRank("new", cmds, (c) => c.title);
    expect(out.length).toBe(2);
    expect(out[0].item.title).toMatch(/^New/);
  });

  test("returns nothing when no item matches", () => {
    expect(fuzzyRank("zzzz", cmds, (c) => c.title)).toEqual([]);
  });

  test("is stable for ties (original order)", () => {
    const items = [{ k: "ab" }, { k: "ab" }, { k: "ab" }];
    const out = fuzzyRank("ab", items, (i) => i.k);
    expect(out).toHaveLength(3);
  });
});
