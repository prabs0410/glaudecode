import { Database } from "bun:sqlite";

// Global full-text search across all sessions (Epic D §3.3). A SQLite index of session
// message text, queried for ranked hits. FTS5 (with bm25 ranking + snippets) is used when
// the SQLite build has it; otherwise we fall back to a LIKE scan so search still works
// (§5 — the index is a rebuildable derived cache). Per-session body is capped to bound the
// pathological huge-session case. Sessions are read via the adapter upstream (Principle XI);
// this module just stores and queries the derived text.

export interface SearchHit {
  sessionId: string;
  snippet: string;
  score: number;
  when?: string;
}

const MAX_BODY = 200_000; // cap per-session indexed chars (huge-session guard)

export class SearchIndex {
  private readonly db: Database;
  /** True if the SQLite build supports FTS5; otherwise a LIKE fallback is used. */
  readonly fts: boolean;

  constructor(path = ":memory:") {
    this.db = new Database(path);
    this.db.run("PRAGMA journal_mode = WAL");
    this.fts = this.initFts();
    if (!this.fts) this.initPlain();
  }

  private initFts(): boolean {
    try {
      this.db.run(
        "CREATE VIRTUAL TABLE IF NOT EXISTS messages USING fts5(sessionId UNINDEXED, ts UNINDEXED, dir UNINDEXED, body)",
      );
      // Migrate a pre-V4 index that predates the `dir` column. The index is a rebuildable
      // derived cache (§5), so dropping it is safe — the next reindex repopulates it.
      if (!this.hasDirColumn()) {
        this.db.run("DROP TABLE messages");
        this.db.run(
          "CREATE VIRTUAL TABLE messages USING fts5(sessionId UNINDEXED, ts UNINDEXED, dir UNINDEXED, body)",
        );
      }
      return true;
    } catch {
      return false;
    }
  }

  private initPlain(): void {
    this.db.run("CREATE TABLE IF NOT EXISTS messages (sessionId TEXT, ts TEXT, dir TEXT, body TEXT)");
    if (!this.hasDirColumn()) {
      this.db.run("DROP TABLE messages");
      this.db.run("CREATE TABLE messages (sessionId TEXT, ts TEXT, dir TEXT, body TEXT)");
    }
    this.db.run("CREATE INDEX IF NOT EXISTS idx_session ON messages(sessionId)");
  }

  /** True if the existing `messages` table already has the `dir` column (post-V4 schema). */
  private hasDirColumn(): boolean {
    try {
      this.db.query("SELECT dir FROM messages LIMIT 1").all();
      return true;
    } catch {
      return false;
    }
  }

  /** Replace a session's indexed text (idempotent re-index). `dir` scopes it to a project. */
  indexSession(sessionId: string, body: string, when?: string, dir?: string): void {
    this.evict(sessionId);
    const capped = body.length > MAX_BODY ? body.slice(0, MAX_BODY) : body;
    this.db.run("INSERT INTO messages (sessionId, ts, dir, body) VALUES (?, ?, ?, ?)", [
      sessionId,
      when ?? "",
      dir ?? "",
      capped,
    ]);
  }

  evict(sessionId: string): void {
    this.db.run("DELETE FROM messages WHERE sessionId = ?", [sessionId]);
  }

  /** Search, optionally scoped to a single project `dir` (V4-B1 — no cross-project leakage). */
  search(query: string, limit = 20, dir?: string): SearchHit[] {
    const terms = query.trim().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    const scoped = dir != null && dir !== "";

    if (this.fts) {
      const match = terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(" ");
      const sql =
        `SELECT sessionId, ts, snippet(messages, 3, '⟦', '⟧', '…', 12) AS snippet, bm25(messages) AS score
         FROM messages WHERE messages MATCH ?${scoped ? " AND dir = ?" : ""} ORDER BY score LIMIT ?`;
      const args = scoped ? [match, dir, limit] : [match, limit];
      const rows = this.db.query(sql).all(...args) as Array<{
        sessionId: string;
        ts: string;
        snippet: string;
        score: number;
      }>;
      return rows.map((r) => ({ sessionId: r.sessionId, snippet: r.snippet, score: r.score, when: r.ts || undefined }));
    }

    // LIKE fallback: AND of terms, manual snippet around the first match.
    const where = terms.map(() => "body LIKE ?").join(" AND ");
    const params = terms.map((t) => `%${t}%`);
    const sql = `SELECT sessionId, ts, body FROM messages WHERE ${where}${scoped ? " AND dir = ?" : ""} LIMIT ?`;
    const args = scoped ? [...params, dir, limit] : [...params, limit];
    const rows = this.db.query(sql).all(...args) as Array<{ sessionId: string; ts: string; body: string }>;
    return rows.map((r) => ({
      sessionId: r.sessionId,
      snippet: makeSnippet(r.body, terms[0]),
      score: 0,
      when: r.ts || undefined,
    }));
  }

  close(): void {
    this.db.close();
  }
}

function makeSnippet(body: string, term: string): string {
  const i = body.toLowerCase().indexOf(term.toLowerCase());
  if (i < 0) return body.slice(0, 120);
  const start = Math.max(0, i - 50);
  const end = Math.min(body.length, i + term.length + 60);
  return (start > 0 ? "…" : "") + body.slice(start, end) + (end < body.length ? "…" : "");
}
