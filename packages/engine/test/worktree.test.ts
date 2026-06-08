import { describe, expect, test } from "bun:test";
import { parseWorktreePorcelain } from "../src/worktree";

describe("parseWorktreePorcelain", () => {
  test("parses main + linked worktrees with branches", () => {
    const out = [
      "worktree /repo",
      "HEAD aaaa1111",
      "branch refs/heads/main",
      "",
      "worktree /repo/.glaudecode/worktrees/feature-x",
      "HEAD bbbb2222",
      "branch refs/heads/feature-x",
      "",
    ].join("\n");
    const wts = parseWorktreePorcelain(out);
    expect(wts).toHaveLength(2);
    expect(wts[0]).toMatchObject({ path: "/repo", branch: "main", head: "aaaa1111", isMain: true });
    expect(wts[1]).toMatchObject({
      path: "/repo/.glaudecode/worktrees/feature-x",
      branch: "feature-x",
      isMain: false,
    });
  });

  test("marks detached and locked worktrees", () => {
    const out = [
      "worktree /repo",
      "HEAD aaaa1111",
      "branch refs/heads/main",
      "",
      "worktree /repo/wt-detached",
      "HEAD cccc3333",
      "detached",
      "",
      "worktree /repo/wt-locked",
      "HEAD dddd4444",
      "branch refs/heads/wip",
      "locked",
      "",
    ].join("\n");
    const wts = parseWorktreePorcelain(out);
    expect(wts[1].detached).toBe(true);
    expect(wts[1].branch).toBeUndefined();
    expect(wts[2].locked).toBe(true);
    expect(wts[2].branch).toBe("wip");
  });

  test("only the first worktree is main", () => {
    const out = "worktree /a\nHEAD 1\nbranch refs/heads/main\n\nworktree /b\nHEAD 2\nbranch refs/heads/b\n";
    const wts = parseWorktreePorcelain(out);
    expect(wts.filter((w) => w.isMain)).toHaveLength(1);
    expect(wts[0].isMain).toBe(true);
  });

  test("tolerates trailing whitespace and empty input", () => {
    expect(parseWorktreePorcelain("")).toEqual([]);
    expect(parseWorktreePorcelain("\n\n")).toEqual([]);
  });
});
