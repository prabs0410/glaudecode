// Approval-hook installer (Epic C §3.2). Smart approval is delivered through a Claude
// Code PreToolUse hook in the project's `.claude/settings.json`: before a tool runs, the
// hook POSTs the call to the engine and returns the decision. This module owns the
// settings hygiene — merge our hook in WITHOUT clobbering the user's own hooks/settings,
// and remove it cleanly (restoring the original shape). All edits are reversible (§5/§6),
// and installation is opt-in (the locked V2 approval decision).

/** Sentinel embedded in our hook command so uninstall can find exactly our entry. */
export const HOOK_SENTINEL = "glaudecode-approval";

interface HookCommand {
  type: "command";
  command: string;
  timeout?: number;
}
interface HookMatcher {
  matcher?: string;
  hooks: HookCommand[];
}
export interface ClaudeSettings {
  hooks?: Record<string, HookMatcher[]>;
  [key: string]: unknown;
}

export interface ApprovalHookOptions {
  /** The shell command the hook runs (reads the tool JSON on stdin, prints a decision). */
  command: string;
  /** Tool-name matcher; defaults to "*" (all tools). */
  matcher?: string;
  /** Per-call timeout (seconds) so a hung approval can't block the agent forever. */
  timeoutSec?: number;
}

export function buildApprovalHookEntry(opts: ApprovalHookOptions): HookMatcher {
  const command = `${opts.command} # ${HOOK_SENTINEL}`;
  const hook: HookCommand = { type: "command", command };
  if (opts.timeoutSec !== undefined) hook.timeout = opts.timeoutSec;
  return { matcher: opts.matcher ?? "*", hooks: [hook] };
}

export function hasApprovalHook(settings: ClaudeSettings): boolean {
  return (settings.hooks?.PreToolUse ?? []).some((m) =>
    m.hooks?.some((h) => typeof h.command === "string" && h.command.includes(HOOK_SENTINEL)),
  );
}

/** Merge our PreToolUse hook in (idempotent; never clobbers existing hooks). */
export function mergeApprovalHook(settings: ClaudeSettings, opts: ApprovalHookOptions): ClaudeSettings {
  if (hasApprovalHook(settings)) return settings;
  const next: ClaudeSettings = structuredClone(settings);
  next.hooks ??= {};
  (next.hooks.PreToolUse ??= []).push(buildApprovalHookEntry(opts));
  return next;
}

/** Remove our hook and prune the empties so the settings return to their prior shape. */
export function removeApprovalHook(settings: ClaudeSettings): ClaudeSettings {
  if (!settings.hooks?.PreToolUse) return settings;
  const next: ClaudeSettings = structuredClone(settings);
  const pre = next.hooks!.PreToolUse!
    .map((m) => ({ ...m, hooks: m.hooks.filter((h) => !h.command.includes(HOOK_SENTINEL)) }))
    .filter((m) => m.hooks.length > 0);
  if (pre.length > 0) next.hooks!.PreToolUse = pre;
  else delete next.hooks!.PreToolUse;
  if (Object.keys(next.hooks!).length === 0) delete next.hooks;
  return next;
}

// ---------- fs installer ----------

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Reads, merges, and writes `<repoDir>/.claude/settings.json`. Opt-in + reversible. */
export class ApprovalHookInstaller {
  settingsPath(repoDir: string): string {
    return join(repoDir, ".claude", "settings.json");
  }

  async isInstalled(repoDir: string): Promise<boolean> {
    return hasApprovalHook(await this.read(repoDir));
  }

  async install(repoDir: string, opts: ApprovalHookOptions): Promise<void> {
    await this.write(repoDir, mergeApprovalHook(await this.read(repoDir), opts));
  }

  async uninstall(repoDir: string): Promise<void> {
    await this.write(repoDir, removeApprovalHook(await this.read(repoDir)));
  }

  /** Tolerant read: missing file → {}, malformed file → throws (don't silently wipe). */
  private async read(repoDir: string): Promise<ClaudeSettings> {
    try {
      const raw = await readFile(this.settingsPath(repoDir), "utf8");
      return raw.trim() ? (JSON.parse(raw) as ClaudeSettings) : {};
    } catch (e: any) {
      if (e?.code === "ENOENT") return {};
      throw new Error(`cannot read ${this.settingsPath(repoDir)}: ${e?.message ?? e}`);
    }
  }

  private async write(repoDir: string, settings: ClaudeSettings): Promise<void> {
    const path = this.settingsPath(repoDir);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(settings, null, 2) + "\n", "utf8");
  }
}
