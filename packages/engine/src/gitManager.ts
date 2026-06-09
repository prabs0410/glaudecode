// GitManager (Epic E §3.1, shared with Epic A). Real git on a worktree: status, diff,
// stage, commit, restore — so the changes panel can act on the agent's edits. All git
// invocations use argument arrays (never string interpolation → injection-safe). The
// porcelain-status and unified-diff parsers are pure and unit-tested; the exec wrappers
// are thin. Git writes (stage/commit/restore) are only ever explicit user actions (§6).

export type GitState = "modified" | "staged" | "untracked" | "deleted";

export interface GitStatusEntry {
  path: string;
  state: GitState;
  /** Raw porcelain XY code, for callers that want detail. */
  code: string;
}

export interface DiffHunk {
  header: string;
  lines: string[];
}
export interface FileDiff {
  path: string;
  hunks: DiffHunk[];
}

/** Parse `git status --porcelain` (v1). Pure. */
export function parseGitStatus(output: string): GitStatusEntry[] {
  const out: GitStatusEntry[] = [];
  for (const line of output.split("\n")) {
    if (line.length < 3) continue;
    const code = line.slice(0, 2);
    let path = line.slice(3).trim();
    // Renames look like "old -> new"; report the new path.
    const arrow = path.indexOf(" -> ");
    if (arrow >= 0) path = path.slice(arrow + 4);
    out.push({ path, code, state: stateForCode(code) });
  }
  return out;
}

function stateForCode(code: string): GitState {
  if (code === "??") return "untracked";
  const [x, y] = [code[0], code[1]];
  if (x === "D" || y === "D") return "deleted";
  if (x !== " " && x !== "?") return "staged"; // has staged changes in the index
  return "modified"; // worktree change, unstaged
}

/** Parse unified `git diff` output into per-file hunks. Pure. */
export function parseUnifiedDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let cur: FileDiff | null = null;
  let hunk: DiffHunk | null = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git")) {
      cur = { path: pathFromDiffHeader(line), hunks: [] };
      files.push(cur);
      hunk = null;
    } else if (line.startsWith("+++ ")) {
      const p = line.slice(4).replace(/^b\//, "").trim();
      if (cur && p && p !== "/dev/null") cur.path = p;
    } else if (line.startsWith("--- ")) {
      // skip the old-file marker
    } else if (line.startsWith("@@")) {
      hunk = { header: line, lines: [] };
      cur?.hunks.push(hunk);
    } else if (hunk && cur) {
      hunk.lines.push(line);
    }
  }
  return files;
}

function pathFromDiffHeader(line: string): string {
  // "diff --git a/foo b/foo" → "foo"
  const m = line.match(/ b\/(.+)$/);
  return m ? m[1] : line.replace("diff --git ", "");
}

// ---------- exec ----------

async function git(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr.trim() || `exit ${code}`}`);
  return stdout;
}

export class GitManager {
  /** True if dir is inside a git work tree. */
  async isRepo(dir: string): Promise<boolean> {
    try {
      return (await git(["rev-parse", "--is-inside-work-tree"], dir)).trim() === "true";
    } catch {
      return false;
    }
  }

  async status(dir: string): Promise<GitStatusEntry[]> {
    return parseGitStatus(await git(["status", "--porcelain"], dir));
  }

  /** Unified diff for the whole worktree or a single path (vs HEAD). */
  async diff(dir: string, path?: string): Promise<FileDiff[]> {
    const args = path ? ["diff", "HEAD", "--", path] : ["diff", "HEAD"];
    return parseUnifiedDiff(await git(args, dir));
  }

  async stage(dir: string, paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await git(["add", "--", ...paths], dir);
  }

  async commit(dir: string, message: string): Promise<string> {
    const out = await git(["commit", "-m", message], dir);
    return out.trim();
  }

  /** Restore (discard) worktree changes for the given paths. */
  async restore(dir: string, paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await git(["restore", "--", ...paths], dir);
  }
}
