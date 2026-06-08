import type { SessionMessage } from "./types";

// Memory & project-instruction access (Epic D §3.1). Claude Code's effectiveness depends
// on what's in memory / AGENTS.md; GlaudeCode makes those visible and editable, and shows
// exactly what was loaded into a given session (its first system message). Memory files
// and AGENTS.md/CLAUDE.md are plain user-owned files → direct read/write (the Principle XI
// adapter rule is about *session* data; these aren't session JSONL). parseLoadedContext is
// pure + tested; MemoryStore does the file I/O.

export interface MemoryFile {
  path: string;
  name: string;
  bytes: number;
}

export interface LoadedContext {
  /** The instructions/memory actually injected for the session (its first system text). */
  instructions?: string;
}

export interface ProjectInstructions {
  path: string;
  content: string;
}

/** Extract what was loaded into a session from its first system message (§2). */
export function parseLoadedContext(messages: SessionMessage[]): LoadedContext {
  for (const m of messages) {
    if (m.role !== "system") continue;
    const text = m.blocks
      .filter((b): b is { kind: "text"; text: string } => b.kind === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (text) return { instructions: text };
  }
  return {};
}

/** Claude Code's project-folder encoding: the cwd path with "/" → "-". */
export function encodeProjectDir(dir: string): string {
  return dir.replace(/\//g, "-");
}

// ---------- file I/O ----------

import { homedir } from "node:os";
import { mkdir, readdir, readFile, writeFile, stat, lstat } from "node:fs/promises";
import { join, resolve, basename } from "node:path";

export class MemoryStore {
  constructor(private readonly home: string = homedir()) {}

  memoryDir(projectDir: string): string {
    return join(this.home, ".claude", "projects", encodeProjectDir(projectDir), "memory");
  }

  async listMemory(projectDir: string): Promise<MemoryFile[]> {
    const dir = this.memoryDir(projectDir);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return []; // no memory yet
    }
    const out: MemoryFile[] = [];
    for (const name of names.sort()) {
      if (!name.endsWith(".md")) continue;
      const path = join(dir, name);
      const bytes = (await stat(path)).size;
      out.push({ path, name, bytes });
    }
    return out;
  }

  async readMemory(projectDir: string, path: string): Promise<string> {
    this.assertInsideMemory(projectDir, path);
    return readFile(path, "utf8");
  }

  async writeMemory(projectDir: string, path: string, content: string): Promise<void> {
    this.assertInsideMemory(projectDir, path);
    await mkdir(this.memoryDir(projectDir), { recursive: true });
    await writeFile(path, content, "utf8");
  }

  /** Read the project's AGENTS.md (preferred) or CLAUDE.md. */
  async readProjectInstructions(projectDir: string): Promise<ProjectInstructions | null> {
    for (const name of ["AGENTS.md", "CLAUDE.md"]) {
      const path = join(projectDir, name);
      try {
        return { path, content: await readFile(path, "utf8") };
      } catch {
        /* try next */
      }
    }
    return null;
  }

  /** Write project instructions, preserving a CLAUDE.md → AGENTS.md symlink (writing
   *  through the link, never replacing it with a divergent copy — load-bearing rule). */
  async writeProjectInstructions(projectDir: string, content: string): Promise<string> {
    const agents = join(projectDir, "AGENTS.md");
    const claude = join(projectDir, "CLAUDE.md");
    // Prefer the real AGENTS.md; fall back to CLAUDE.md if that's all there is.
    const target = (await exists(agents)) ? agents : (await exists(claude)) ? claude : agents;
    await writeFile(target, content, "utf8"); // follows a symlink → target updated, link intact
    return target;
  }

  private assertInsideMemory(projectDir: string, path: string): void {
    const dir = resolve(this.memoryDir(projectDir));
    const p = resolve(path);
    if (p !== dir && !p.startsWith(dir + "/")) {
      throw new Error(`refusing to access path outside the memory dir: ${basename(path)}`);
    }
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}
