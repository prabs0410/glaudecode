# Epic D — Memory & Knowledge

**Status:** Draft for review
**Depends on:** V1 engine/adapter
**Features:** memory tab + in-app AGENTS.md editor, knowledge graph (graphify), global semantic search

## 1. Problem & user value
Claude Code's effectiveness depends on what's in its memory/`AGENTS.md` — but editing those means
leaving the terminal, and there's no way to *see what was actually loaded* or to *find that thing you
did three sessions ago*. GlaudeCode makes memory visible/editable, surfaces a knowledge graph of the
project, and searches across all your sessions' content.

**Felt-improvement test:** "what's actually loaded into context" + cross-session content search are
genuinely differentiated; AGENTS.md editing leans into the cross-tool-standard wedge.

## 2. Research / constraints
- **The session's first JSONL record is a system message containing the injected `CLAUDE.md`/memory
  content** (confirmed in V1 research). So we can show *exactly what was loaded* for a session, not a
  guess.
- **Memory lives at** `~/.claude/projects/<encoded>/memory/*.md` + `MEMORY.md`; project instructions
  at `AGENTS.md`/`CLAUDE.md` (symlinked). Plain files → simple read/write.
- **graphify** (MIT) — `graphify extract <dir>` → `graphify-out/graph.json` (+ `graph.html`), or an
  MCP server. Python 3.10+ → spawning it adds a **bundled-Python dependency** to the app. (Verified
  earlier.)
- **"Semantic" search needs embeddings** (a model + vector index) — heavier. Honest staging:
  **V2 ships fast full-text search** (SQLite FTS5 over message text, incremental); embedding-based
  semantic ranking is a tracked enhancement, not V2-blocking.

## 3. Architecture
### 3.1 Memory tab + AGENTS.md editor (engine file I/O + UI)
- Engine RPCs: `listMemory(dir)`, `readMemory(path)`, `writeMemory(path, content)`,
  `readProjectInstructions(dir)` (AGENTS.md/CLAUDE.md), `writeProjectInstructions(...)`.
- `loadedContext(sessionId, dir)` → parse the session's first system message → the actual injected
  memory/instructions for that session.
- UI: a Memory panel — list memory files, edit in a code editor (CodeMirror, already in the Terax-style
  stack), plus an "AGENTS.md" editor and a read-only "loaded into this session" view.
- Writes go through the editor with save; the symlink (`CLAUDE.md → AGENTS.md`) is respected, never
  replaced with a divergent copy (per AGENTS.md rule).

### 3.2 Knowledge graph (graphify integration)
- Engine `buildGraph(dir)` spawns `graphify extract` (Python subprocess), reads `graph.json`.
- UI renders it with a force-directed graph (a lightweight WebView graph lib) — nodes = files/symbols,
  edges = relationships. Click a node → reveal/copy path (ties to Epic E git/changes).
- Python is an **optional** dependency: the feature degrades gracefully (clear "install Python +
  graphify to enable") if absent.

### 3.3 Global search (engine index)
- Engine maintains a **SQLite FTS5 index** of message text across all sessions
  (`~/.glaudecode/index.db`), built incrementally (watch for new/changed session files, index deltas).
- RPC `search(query, opts)` → ranked results `{ sessionId, snippet, score, when }`.
- UI: a global search (Cmd-P style, ties to Epic F command palette) → jump to the session/message.
- **Indexing respects Principle XI:** read sessions via the adapter, not raw JSONL, where possible;
  the index is a derived cache, rebuildable.

## 4. Data model
```ts
interface MemoryFile { path: string; name: string; bytes: number }
interface LoadedContext { instructions?: string; memory: string[] /* file contents loaded */ }
interface GraphNode { id: string; label: string; kind: string }
interface GraphEdge { from: string; to: string; kind: string }
interface SearchHit { sessionId: string; snippet: string; score: number; when?: string }
```

## 5. Edge cases & failure modes
- **AGENTS.md is a symlink** → edit the target, never break the link (load-bearing per AGENTS.md).
- **graphify/Python missing** → feature shows an enable-guide; no crash.
- **Large graph** (huge repo) → cap nodes / cluster; warn.
- **Index staleness / corruption** → the FTS db is a rebuildable cache; on parse error, rebuild.
- **Session-delete** (V1) must also evict from the index.
- **Huge session files** (the 3.8GB pathological case) → cap per-session indexed bytes; skip + log.

## 6. Security
- Memory/AGENTS.md writes are local files the user already owns; confirm-on-save for AGENTS.md.
- graphify subprocess runs with the project dir as cwd; no network.
- The search index is local; never leaves the machine.

## 7. Test plan
- **Unit (pure):** parse `loadedContext` from a fixture system message; graph.json → GraphNode/Edge
  mapping; search snippet/ranking shaping.
- **Integration:** memory read/write round-trip; FTS index add/query/evict; graphify spawn (skipped
  if Python absent).
- **Manual:** editor UX, graph rendering, search-to-jump.

## 8. Acceptance criteria
- View + edit memory and `AGENTS.md` from the app; edits persist; symlink preserved.
- See exactly what memory/instructions were loaded into a given session.
- Project knowledge graph renders (when graphify+Python present); degrades gracefully otherwise.
- Global full-text search returns ranked results across all sessions and jumps to them.

## 9. Open questions (for review)
1. **Bundle Python+graphify, or require the user to install them?** Recommend: optional/guide-to-install
   for V2 (avoid shipping a Python runtime); revisit bundling later.
2. **Editor component** — CodeMirror (rich) vs a simple textarea for V2 memory editing.
3. **Semantic (embedding) search** — confirm it's a post-V2 enhancement; FTS5 ships first.
