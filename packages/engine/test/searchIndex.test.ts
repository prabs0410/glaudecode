import { afterEach, describe, expect, test } from "bun:test";
import { SearchIndex } from "../src/searchIndex";

let idx: SearchIndex;
afterEach(() => idx?.close());

describe("SearchIndex", () => {
  test("finds sessions whose text matches the query", () => {
    idx = new SearchIndex();
    idx.indexSession("s1", "the worktree manager parses porcelain output", "2026-06-09");
    idx.indexSession("s2", "the cost counter estimates dollars from tokens", "2026-06-08");

    const hits = idx.search("worktree");
    expect(hits).toHaveLength(1);
    expect(hits[0].sessionId).toBe("s1");
    expect(hits[0].when).toBe("2026-06-09");
  });

  test("AND-matches multiple terms", () => {
    idx = new SearchIndex();
    idx.indexSession("s1", "approval queue with fail closed defaults");
    idx.indexSession("s2", "approval card renders in the panel");
    const hits = idx.search("approval queue");
    expect(hits.map((h) => h.sessionId)).toEqual(["s1"]);
  });

  test("re-indexing a session replaces its prior text", () => {
    idx = new SearchIndex();
    idx.indexSession("s1", "alpha beta");
    idx.indexSession("s1", "gamma delta");
    expect(idx.search("alpha")).toEqual([]);
    expect(idx.search("gamma")).toHaveLength(1);
  });

  test("evict removes a session from the index", () => {
    idx = new SearchIndex();
    idx.indexSession("s1", "findable text");
    expect(idx.search("findable")).toHaveLength(1);
    idx.evict("s1");
    expect(idx.search("findable")).toEqual([]);
  });

  test("empty query returns nothing", () => {
    idx = new SearchIndex();
    idx.indexSession("s1", "whatever");
    expect(idx.search("   ")).toEqual([]);
  });

  test("returns a bounded snippet around the match", () => {
    idx = new SearchIndex();
    const filler = "lorem ipsum dolor sit amet ".repeat(40); // ~1080 chars of words
    idx.indexSession("s1", filler + " NEEDLE " + filler);
    const hit = idx.search("NEEDLE")[0];
    expect(hit.snippet).toContain("NEEDLE");
    // a snippet, not the whole ~2KB body
    expect(hit.snippet.length).toBeLessThan(400);
  });

  test("scopes results to a project dir (no cross-project leakage)", () => {
    idx = new SearchIndex();
    idx.indexSession("a1", "shared keyword in project A", "2026-06-09", "/projects/a");
    idx.indexSession("b1", "shared keyword in project B", "2026-06-09", "/projects/b");

    const aHits = idx.search("keyword", 20, "/projects/a");
    expect(aHits.map((h) => h.sessionId)).toEqual(["a1"]);

    const bHits = idx.search("keyword", 20, "/projects/b");
    expect(bHits.map((h) => h.sessionId)).toEqual(["b1"]);

    // No dir → unscoped (back-compat): both projects match.
    expect(idx.search("keyword").map((h) => h.sessionId).sort()).toEqual(["a1", "b1"]);
  });

  test("special characters in the query don't break FTS syntax", () => {
    idx = new SearchIndex();
    idx.indexSession("s1", "a path/to/file.ts was changed");
    // quotes/slashes shouldn't throw
    expect(() => idx.search('path/to/file.ts "weird')).not.toThrow();
  });
});
