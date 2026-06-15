// Git worktree management for multi-session orchestration (Epic A). git is invoked
// via argument arrays (never string interpolation — injection-safe). The porcelain
// parser is pure and unit-tested; the exec wrappers are thin.

export interface WorktreeInfo {
  path: string;
  branch?: string;
  head?: string;
  isMain: boolean;
  locked: boolean;
  detached: boolean;
}

/** Parse `git worktree list --porcelain` output. Pure. */
export function parseWorktreePorcelain(output: string): WorktreeInfo[] {
  const blocks = output.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  return blocks.map((block, idx) => {
    const lines = block.split("\n");
    const info: WorktreeInfo = {
      path: "",
      isMain: idx === 0, // git lists the main worktree first
      locked: false,
      detached: false,
    };
    for (const line of lines) {
      if (line.startsWith("worktree ")) info.path = line.slice("worktree ".length).trim();
      else if (line.startsWith("HEAD ")) info.head = line.slice("HEAD ".length).trim();
      else if (line.startsWith("branch ")) {
        info.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
      } else if (line === "detached") info.detached = true;
      else if (line === "locked" || line.startsWith("locked ")) info.locked = true;
    }
    return info;
  });
}

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

export class WorktreeManager {
  async listWorktrees(repoDir: string): Promise<WorktreeInfo[]> {
    return parseWorktreePorcelain(await git(["worktree", "list", "--porcelain"], repoDir));
  }

  /** Create a worktree on a new branch under <repoDir>/.glaudecode/worktrees/<branch>. */
  async createWorktree(repoDir: string, branch: string, path?: string): Promise<string> {
    // The branch is passed unsanitized to `git worktree add -b` and is reachable by a steer phone,
    // so reject a leading-dash (flag injection) / ref-format-illegal name before it hits git (L5).
    if (!isValidBranchName(branch)) throw new Error(`invalid branch name: ${branch}`);
    const target = path ?? `${repoDir}/.glaudecode/worktrees/${sanitizeBranch(branch)}`;
    await git(["worktree", "add", target, "-b", branch], repoDir);
    return target;
  }

  async removeWorktree(repoDir: string, path: string, force = false): Promise<void> {
    const args = ["worktree", "remove", path];
    if (force) args.push("--force");
    await git(args, repoDir);
  }
}

function sanitizeBranch(branch: string): string {
  return branch.replace(/[^a-zA-Z0-9._-]/g, "-");
}

/** A conservative `git check-ref-format`-style guard (audit L5): non-empty, no leading '-' (which
 *  `git ... -b` would read as a flag), no whitespace or git-illegal chars, no `..`, no trailing
 *  '/' or '.lock'. git itself enforces the full rules; this rejects the dangerous cases early. */
export function isValidBranchName(branch: string): boolean {
  return (
    branch.length > 0 &&
    !branch.startsWith("-") &&
    !branch.startsWith("/") &&
    !branch.endsWith("/") &&
    !branch.endsWith(".lock") &&
    !branch.includes("..") &&
    !branch.includes("@{") &&
    !/[\s~^:?*[\\]/.test(branch)
  );
}
