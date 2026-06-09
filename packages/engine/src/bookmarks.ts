// Bookmarks (Epic E §3.7). Pin a message/turn for later. Stored by GlaudeCode at
// ~/.glaudecode/bookmarks/<sessionId>.json — NEVER inside Claude Code's session JSONL
// (we never mutate its files, §6). Pruned when a session is deleted. The store is small
// JSON I/O; tested against a temp home.

import { homedir } from "node:os";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface Bookmark {
  sessionId: string;
  messageId: string;
  note?: string;
  at: string;
}

export class BookmarkStore {
  constructor(private readonly home: string = homedir()) {}

  private path(sessionId: string): string {
    return join(this.home, ".glaudecode", "bookmarks", `${sanitize(sessionId)}.json`);
  }

  async list(sessionId: string): Promise<Bookmark[]> {
    try {
      const raw = await readFile(this.path(sessionId), "utf8");
      const parsed = raw.trim() ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e: any) {
      if (e?.code === "ENOENT") return [];
      throw e;
    }
  }

  /** Add a bookmark (idempotent per messageId). Returns the updated list. */
  async add(sessionId: string, messageId: string, note: string | undefined, at: string): Promise<Bookmark[]> {
    const list = await this.list(sessionId);
    if (list.some((b) => b.messageId === messageId)) return list;
    list.push({ sessionId, messageId, note, at });
    await this.write(sessionId, list);
    return list;
  }

  async remove(sessionId: string, messageId: string): Promise<Bookmark[]> {
    const list = (await this.list(sessionId)).filter((b) => b.messageId !== messageId);
    await this.write(sessionId, list);
    return list;
  }

  /** Drop a session's bookmarks entirely (called on session delete). */
  async prune(sessionId: string): Promise<void> {
    await rm(this.path(sessionId), { force: true });
  }

  private async write(sessionId: string, list: Bookmark[]): Promise<void> {
    const path = this.path(sessionId);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(list, null, 2) + "\n", "utf8");
  }
}

function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, "-") || "session";
}
