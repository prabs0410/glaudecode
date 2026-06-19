import { describe, expect, test } from "bun:test";
import { matchModelKey } from "../src/modelMatch";

describe("matchModelKey (longest-key-first, exact-preferred — #38)", () => {
  test("exact (case-insensitive) match wins and is flagged exact", () => {
    expect(matchModelKey("opus", ["opus", "sonnet"])).toEqual({ key: "opus", exact: true });
    expect(matchModelKey("OPUS", ["opus"])).toEqual({ key: "opus", exact: true });
    expect(matchModelKey("claude-opus-4", ["claude-opus-4", "opus"])).toEqual({ key: "claude-opus-4", exact: true });
  });

  test("substring match is flagged heuristic (not exact)", () => {
    expect(matchModelKey("claude-opus-4-20250514", ["opus", "sonnet", "haiku"])).toEqual({ key: "opus", exact: false });
  });

  test("the LONGEST matching key wins, regardless of key order (the bug)", () => {
    // A model id containing BOTH "opus" and the more-specific "opus-4" must resolve to "opus-4",
    // not whichever Object.keys order surfaced first.
    const keys = ["opus", "opus-4"]; // "opus" comes first — first-substring-wins would mis-pick it
    expect(matchModelKey("claude-opus-4-1", keys)!.key).toBe("opus-4");
    // …and the same with the order reversed proves it's length-driven, not order-driven.
    expect(matchModelKey("claude-opus-4-1", ["opus-4", "opus"])!.key).toBe("opus-4");
  });

  test("mis-pricing scenario: a new family token nested in a longer key resolves to the longer key", () => {
    // Suppose a future "haiku" model and a premium "haiku-max"; "claude-haiku-max" must pick haiku-max.
    expect(matchModelKey("claude-haiku-max-1", ["haiku", "haiku-max"])!.key).toBe("haiku-max");
  });

  test("no match → null", () => {
    expect(matchModelKey("gpt-4o", ["opus", "sonnet", "haiku"])).toBeNull();
    expect(matchModelKey("", ["opus"])).toBeNull();
    expect(matchModelKey("opus", [])).toBeNull();
  });

  test("ties on length keep the earliest key (stable)", () => {
    // "abc" and "xyz" are both length 3 and both substrings; the earliest listed wins.
    expect(matchModelKey("zzabcxyz", ["abc", "xyz"])!.key).toBe("abc");
    expect(matchModelKey("zzabcxyz", ["xyz", "abc"])!.key).toBe("xyz");
  });

  test("ignores empty keys and accepts any iterable", () => {
    expect(matchModelKey("claude-sonnet-4", new Set(["", "sonnet"]))).toEqual({ key: "sonnet", exact: false });
  });
});
