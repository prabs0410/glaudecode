// Prompt library + slash-command builder (Epic F §3.3). Reusable prompts live at
// ~/.glaudecode/prompts/*.md with optional {{variables}}; "use prompt" fills them and types
// the result into the active pane. The slash-command builder writes .claude/commands/<name>.md
// so a built command works in the real `claude` (merge-safe: it refuses to overwrite an
// existing command). The template helpers are pure + unit-tested; the stores are file I/O.

export interface PromptInfo {
  id: string;
  name: string;
  variables: string[];
}

const VAR_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Unique {{variable}} names in a prompt body, in first-seen order. */
export function extractVariables(body: string): string[] {
  const seen = new Set<string>();
  for (const m of body.matchAll(VAR_RE)) seen.add(m[1]);
  return [...seen];
}

/** Fill {{variables}}; report any left unfilled (insertion is blocked until filled). */
export function fillTemplate(body: string, values: Record<string, string>): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = body.replace(VAR_RE, (_, name: string) => {
    const v = values[name];
    if (v === undefined || v === "") {
      if (!missing.includes(name)) missing.push(name);
      return `{{${name}}}`;
    }
    return v;
  });
  return { text, missing };
}

// ---------- stores ----------

import { homedir } from "node:os";
import { mkdir, readdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";

function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^-+|-+$/g, "") || "prompt";
}

export class PromptStore {
  constructor(private readonly home: string = homedir()) {}

  private dir(): string {
    return join(this.home, ".glaudecode", "prompts");
  }

  async list(): Promise<PromptInfo[]> {
    let names: string[];
    try {
      names = await readdir(this.dir());
    } catch {
      return [];
    }
    const out: PromptInfo[] = [];
    for (const file of names.sort()) {
      if (!file.endsWith(".md")) continue;
      const id = file.replace(/\.md$/, "");
      const body = await readFile(join(this.dir(), file), "utf8");
      out.push({ id, name: id, variables: extractVariables(body) });
    }
    return out;
  }

  async read(id: string): Promise<string> {
    return readFile(join(this.dir(), `${sanitize(id)}.md`), "utf8");
  }

  async save(id: string, body: string): Promise<string> {
    const safe = sanitize(id);
    await mkdir(this.dir(), { recursive: true });
    await writeFile(join(this.dir(), `${safe}.md`), body, "utf8");
    return safe;
  }

  async remove(id: string): Promise<void> {
    await rm(join(this.dir(), `${sanitize(id)}.md`), { force: true });
  }
}

export class SlashCommandWriter {
  private dir(repoDir: string): string {
    return join(repoDir, ".claude", "commands");
  }

  async list(repoDir: string): Promise<string[]> {
    try {
      return (await readdir(this.dir(repoDir))).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""));
    } catch {
      return [];
    }
  }

  /** Write a slash command. Refuses to overwrite an existing one (collision warning, §5). */
  async write(repoDir: string, name: string, body: string): Promise<string> {
    const safe = sanitize(name);
    const path = join(this.dir(repoDir), `${safe}.md`);
    if (await exists(path)) throw new Error(`slash command "${safe}" already exists — choose another name`);
    await mkdir(this.dir(repoDir), { recursive: true });
    await writeFile(path, body, "utf8");
    return `/${safe}`;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
