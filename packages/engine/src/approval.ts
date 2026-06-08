// Smart-approval policy (Epic C §3.2). A pure, tested classifier that decides whether a
// tool call can run unattended ("auto-allow"), needs a human ("ask"), or must never run
// ("auto-deny"). Safe-by-default: read-only tools auto-allow; everything else asks;
// a few catastrophic shell patterns auto-deny. The classification also flags whether a
// call is *dangerous*, which the hook uses to fail closed when the engine is unreachable
// (dangerous → deny/ask; read-only → allow — the locked V2 approval decision).

export type ToolDecision = "auto-allow" | "ask" | "auto-deny";

export interface ToolClassification {
  decision: ToolDecision;
  dangerous: boolean;
  reason: string;
}

// Tools that only read state — safe to run unattended.
const READ_ONLY = new Set(["Read", "Glob", "Grep", "LS", "NotebookRead"]);
const FILE_EDIT = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

// Shell patterns that should NEVER run unattended → auto-deny (blast-radius control).
const CATASTROPHIC: RegExp[] = [
  /\brm\s+-[a-z]*[rf][a-z]*\s+(\/|~|\$HOME|\.)(\s|$)/i, // rm -rf / | ~ | $HOME | .
  /:\s*\(\s*\)\s*\{/, // fork bomb: a shell function literally named ":" — :(){ ... }
  /\bmkfs\b/i,
  /\bdd\b[^|]*\bof=\/dev\/(sd|nvme|disk)/i, // overwrite a raw disk
  />\s*\/dev\/(sd|nvme|disk)/i,
];

// Risky-but-sometimes-legitimate shell patterns → ask, flagged dangerous.
const DANGEROUS_BASH: RegExp[] = [
  /\brm\s+-[a-z]*[rf]/i,
  /\bgit\s+push\b/i,
  /--force\b/i,
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bsudo\b/i,
  /\bchmod\s+(-R\s+)?777\b/i,
  /\b(npm|yarn|pnpm)\s+publish\b/i,
];

export interface ClassifyOptions {
  /** Repo root; a file edit whose path escapes it is flagged dangerous. */
  repoDir?: string;
}

export function classifyTool(name: string, input: unknown, opts: ClassifyOptions = {}): ToolClassification {
  if (READ_ONLY.has(name)) {
    return { decision: "auto-allow", dangerous: false, reason: "read-only tool" };
  }

  if (name === "Bash") {
    const cmd = String((input as any)?.command ?? "");
    if (CATASTROPHIC.some((re) => re.test(cmd))) {
      return { decision: "auto-deny", dangerous: true, reason: "catastrophic shell command blocked" };
    }
    const risky = DANGEROUS_BASH.some((re) => re.test(cmd));
    return {
      decision: "ask",
      dangerous: risky,
      reason: risky ? "shell command matches a risky pattern" : "shell command",
    };
  }

  if (FILE_EDIT.has(name)) {
    const fp = String((input as any)?.file_path ?? (input as any)?.notebook_path ?? "");
    const outside = !!opts.repoDir && !!fp && !isInside(fp, opts.repoDir);
    return {
      decision: "ask",
      dangerous: outside,
      reason: outside ? "writes outside the project directory" : "file edit",
    };
  }

  return { decision: "ask", dangerous: false, reason: "requires review" };
}

/** True if an absolute path is within repoDir. Relative paths are assumed inside. */
function isInside(filePath: string, repoDir: string): boolean {
  if (!filePath.startsWith("/")) return true; // relative → resolved against cwd (inside)
  const base = repoDir.endsWith("/") ? repoDir : repoDir + "/";
  return filePath === repoDir || filePath.startsWith(base);
}
