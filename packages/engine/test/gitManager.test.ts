import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitManager, buildHunkPatch, parseGitStatus, parseUnifiedDiff } from "../src/gitManager";

describe("parseGitStatus", () => {
  test("classifies untracked, modified, staged, deleted", () => {
    const out = parseGitStatus(["?? new.ts", " M edited.ts", "M  staged.ts", " D gone.ts", ""].join("\n"));
    expect(out).toEqual([
      { path: "new.ts", code: "??", state: "untracked" },
      { path: "edited.ts", code: " M", state: "modified" },
      { path: "staged.ts", code: "M ", state: "staged" },
      { path: "gone.ts", code: " D", state: "deleted" },
    ]);
  });

  test("reports the new path for renames", () => {
    const out = parseGitStatus("R  old.ts -> new.ts");
    expect(out[0].path).toBe("new.ts");
    expect(out[0].state).toBe("staged");
  });
});

describe("parseUnifiedDiff", () => {
  test("splits files and hunks", () => {
    const diff = [
      "diff --git a/foo.ts b/foo.ts",
      "index 111..222 100644",
      "--- a/foo.ts",
      "+++ b/foo.ts",
      "@@ -1,2 +1,3 @@",
      " context",
      "-removed",
      "+added",
      "+added2",
    ].join("\n");
    const files = parseUnifiedDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("foo.ts");
    expect(files[0].hunks).toHaveLength(1);
    expect(files[0].hunks[0].header).toBe("@@ -1,2 +1,3 @@");
    expect(files[0].hunks[0].lines).toContain("+added");
  });

  test("handles multiple files", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "+++ b/a.ts",
      "@@ -0,0 +1 @@",
      "+a",
      "diff --git a/b.ts b/b.ts",
      "+++ b/b.ts",
      "@@ -0,0 +1 @@",
      "+b",
    ].join("\n");
    const files = parseUnifiedDiff(diff);
    expect(files.map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
  });
});

const tmpDirs: string[] = [];
afterAll(async () => {
  for (const d of tmpDirs) await rm(d, { recursive: true, force: true });
});

async function initRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "glaude-git-"));
  tmpDirs.push(dir);
  const run = (args: string[]) => Bun.spawn(["git", ...args], { cwd: dir, stdout: "ignore", stderr: "ignore" }).exited;
  await run(["init"]);
  await run(["config", "user.email", "t@e.st"]);
  await run(["config", "user.name", "Test"]);
  await writeFile(join(dir, "seed.txt"), "seed\n");
  await run(["add", "."]);
  await run(["commit", "-m", "seed"]);
  return dir;
}

describe("GitManager (real repo)", () => {
  test("status → stage → commit → restore", async () => {
    const dir = await initRepo();
    const gm = new GitManager();
    expect(await gm.isRepo(dir)).toBe(true);

    await writeFile(join(dir, "seed.txt"), "seed\nmore\n");
    await writeFile(join(dir, "fresh.txt"), "hello\n");

    let status = await gm.status(dir);
    expect(status.find((s) => s.path === "seed.txt")?.state).toBe("modified");
    expect(status.find((s) => s.path === "fresh.txt")?.state).toBe("untracked");

    const diff = await gm.diff(dir, "seed.txt");
    expect(diff[0].path).toBe("seed.txt");
    expect(diff[0].hunks[0].lines.some((l) => l.startsWith("+more"))).toBe(true);

    await gm.stage(dir, ["seed.txt", "fresh.txt"]);
    status = await gm.status(dir);
    expect(status.every((s) => s.state === "staged")).toBe(true);

    await gm.commit(dir, "agent changes");
    expect(await gm.status(dir)).toEqual([]); // clean tree

    // restore discards an unstaged edit
    await writeFile(join(dir, "seed.txt"), "seed\nmore\nclobber\n");
    await gm.restore(dir, ["seed.txt"]);
    expect(await gm.status(dir)).toEqual([]);
  });

  test("isRepo is false outside a repo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glaude-norepo-"));
    tmpDirs.push(dir);
    expect(await new GitManager().isRepo(dir)).toBe(false);
  });

  test("revertHunk restores a single hunk to HEAD", async () => {
    const dir = await initRepo();
    const gm = new GitManager();
    // seed.txt is "seed\n" at HEAD; add a line.
    await writeFile(join(dir, "seed.txt"), "seed\nADDED\n");
    const diff = await gm.diff(dir, "seed.txt");
    expect(diff[0].hunks).toHaveLength(1);

    await gm.revertHunk(dir, "seed.txt", diff[0].hunks[0]);
    // worktree back to HEAD → clean
    expect(await gm.status(dir)).toEqual([]);
  });
});

describe("buildHunkPatch", () => {
  test("emits a valid one-file one-hunk patch", () => {
    const patch = buildHunkPatch("foo.ts", { header: "@@ -1 +1,2 @@", lines: [" a", "+b"] });
    expect(patch).toContain("diff --git a/foo.ts b/foo.ts");
    expect(patch).toContain("+++ b/foo.ts");
    expect(patch).toContain("@@ -1 +1,2 @@");
    expect(patch.endsWith("\n")).toBe(true);
  });
});
