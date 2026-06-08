import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ApprovalHookInstaller,
  HOOK_SENTINEL,
  hasApprovalHook,
  mergeApprovalHook,
  removeApprovalHook,
  type ClaudeSettings,
} from "../src/approvalHook";

const opts = { command: "bun /x/approval-hook.ts" };

describe("merge/remove approval hook (pure)", () => {
  test("adds a PreToolUse hook carrying the sentinel", () => {
    const out = mergeApprovalHook({}, opts);
    expect(hasApprovalHook(out)).toBe(true);
    expect(out.hooks!.PreToolUse![0].hooks[0].command).toContain(HOOK_SENTINEL);
    expect(out.hooks!.PreToolUse![0].matcher).toBe("*");
  });

  test("is idempotent — merging twice yields one entry", () => {
    const once = mergeApprovalHook({}, opts);
    const twice = mergeApprovalHook(once, opts);
    expect(twice.hooks!.PreToolUse).toHaveLength(1);
  });

  test("preserves the user's existing hooks and other settings", () => {
    const user: ClaudeSettings = {
      model: "claude-opus-4-8",
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo mine" }] }],
        PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "echo after" }] }],
      },
    };
    const merged = mergeApprovalHook(user, opts);
    expect(merged.model).toBe("claude-opus-4-8");
    expect(merged.hooks!.PreToolUse).toHaveLength(2); // user's + ours
    expect(merged.hooks!.PostToolUse).toHaveLength(1);
  });

  test("remove restores the exact original shape (round-trip)", () => {
    const user: ClaudeSettings = {
      model: "x",
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo mine" }] }] },
    };
    const restored = removeApprovalHook(mergeApprovalHook(user, opts));
    expect(restored).toEqual(user);
  });

  test("remove from a settings that only had our hook drops hooks entirely", () => {
    const restored = removeApprovalHook(mergeApprovalHook({}, opts));
    expect(restored).toEqual({});
  });
});

const tmpDirs: string[] = [];
afterAll(async () => {
  for (const d of tmpDirs) await rm(d, { recursive: true, force: true });
});

describe("ApprovalHookInstaller (fs)", () => {
  test("install → isInstalled → uninstall round-trips and preserves user settings", async () => {
    const repo = await mkdtemp(join(tmpdir(), "glaude-approve-"));
    tmpDirs.push(repo);
    await mkdir(join(repo, ".claude"), { recursive: true });
    await writeFile(join(repo, ".claude", "settings.json"), JSON.stringify({ model: "keep-me" }, null, 2));

    const inst = new ApprovalHookInstaller();
    expect(await inst.isInstalled(repo)).toBe(false);

    await inst.install(repo, opts);
    expect(await inst.isInstalled(repo)).toBe(true);
    const afterInstall = JSON.parse(await readFile(inst.settingsPath(repo), "utf8"));
    expect(afterInstall.model).toBe("keep-me");

    await inst.uninstall(repo);
    expect(await inst.isInstalled(repo)).toBe(false);
    const afterUninstall = JSON.parse(await readFile(inst.settingsPath(repo), "utf8"));
    expect(afterUninstall).toEqual({ model: "keep-me" });
  });

  test("install works when settings.json does not exist yet", async () => {
    const repo = await mkdtemp(join(tmpdir(), "glaude-approve2-"));
    tmpDirs.push(repo);
    const inst = new ApprovalHookInstaller();
    await inst.install(repo, opts);
    expect(await inst.isInstalled(repo)).toBe(true);
  });
});
