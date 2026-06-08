import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore, encodeProjectDir, parseLoadedContext } from "../src/memory";
import type { SessionMessage } from "../src/types";

describe("parseLoadedContext", () => {
  test("returns the first system message's text as the loaded instructions", () => {
    const msgs: SessionMessage[] = [
      { id: "1", role: "system", blocks: [{ kind: "text", text: "# Loaded CLAUDE.md\nrules here" }] },
      { id: "2", role: "user", blocks: [{ kind: "text", text: "hi" }] },
    ];
    expect(parseLoadedContext(msgs).instructions).toBe("# Loaded CLAUDE.md\nrules here");
  });

  test("undefined when there is no system message", () => {
    expect(parseLoadedContext([{ id: "1", role: "user", blocks: [] }]).instructions).toBeUndefined();
  });
});

describe("encodeProjectDir", () => {
  test("replaces slashes with dashes (Claude Code scheme)", () => {
    expect(encodeProjectDir("/Users/me/repo")).toBe("-Users-me-repo");
  });
});

const tmpDirs: string[] = [];
afterAll(async () => {
  for (const d of tmpDirs) await rm(d, { recursive: true, force: true });
});

describe("MemoryStore (fs)", () => {
  test("lists, reads, and writes memory files", async () => {
    const home = await mkdtemp(join(tmpdir(), "glaude-mem-"));
    tmpDirs.push(home);
    const project = "/proj/x";
    const store = new MemoryStore(home);
    const dir = store.memoryDir(project);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "a.md"), "alpha");

    const list = await store.listMemory(project);
    expect(list.map((m) => m.name)).toEqual(["a.md"]);
    expect(await store.readMemory(project, list[0].path)).toBe("alpha");

    await store.writeMemory(project, join(dir, "b.md"), "beta");
    expect((await store.listMemory(project)).map((m) => m.name)).toEqual(["a.md", "b.md"]);
  });

  test("refuses to read outside the memory dir (path traversal)", async () => {
    const home = await mkdtemp(join(tmpdir(), "glaude-mem2-"));
    tmpDirs.push(home);
    const store = new MemoryStore(home);
    await expect(store.readMemory("/proj/x", "/etc/passwd")).rejects.toThrow(/outside the memory dir/);
  });

  test("missing memory dir lists empty", async () => {
    const home = await mkdtemp(join(tmpdir(), "glaude-mem3-"));
    tmpDirs.push(home);
    expect(await new MemoryStore(home).listMemory("/nope")).toEqual([]);
  });

  test("reads AGENTS.md and writes through a CLAUDE.md symlink without breaking it", async () => {
    const home = await mkdtemp(join(tmpdir(), "glaude-mem4-"));
    tmpDirs.push(home);
    const project = await mkdtemp(join(tmpdir(), "glaude-proj-"));
    tmpDirs.push(project);
    await writeFile(join(project, "AGENTS.md"), "original");
    await symlink(join(project, "AGENTS.md"), join(project, "CLAUDE.md"));

    const store = new MemoryStore(home);
    const read = await store.readProjectInstructions(project);
    expect(read?.content).toBe("original");

    const target = await store.writeProjectInstructions(project, "updated");
    expect(target).toBe(join(project, "AGENTS.md"));
    // AGENTS.md updated, CLAUDE.md still a symlink pointing at it
    expect(await readFile(join(project, "AGENTS.md"), "utf8")).toBe("updated");
    expect((await lstat(join(project, "CLAUDE.md"))).isSymbolicLink()).toBe(true);
    expect(await readFile(join(project, "CLAUDE.md"), "utf8")).toBe("updated");
  });
});
