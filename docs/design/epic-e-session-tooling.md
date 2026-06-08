# Epic E — Session Tooling

**Status:** Draft for review
**Depends on:** V1 (sessions, timeline, changes); Epic A (git foundation overlaps worktrees)
**Features:** session compare/diff, semantic resume, replay/share, bookmarks, inline diff editor, git integration in changes

## 1. Problem & user value
Once you have many sessions and the agent edits real files, you need to: compare two runs, pick up a
session with context, share/replay a session, mark key moments, and act on the agent's changes
(diff/stage/commit/revert) without leaving the terminal. These deepen V1's sessions sidebar and
changes panel into a real working surface.

**Felt-improvement test:** session compare, replay/share, and git-in-the-changes-panel are
differentiated; inline diff is commoditized (Anthropic/Terax have it) → lower priority within E.

## 2. Research / constraints
- **Changes are derived from tool calls** (V1 `buildChanges`). For real diffs/stage/commit we use
  **git** directly on the worktree (status/diff/add/commit/restore), arg-array calls (injection-safe),
  reusing the Epic A git foundation.
- **Replay must be privacy-aware** — session transcripts can contain secrets; export offers a
  redaction pass and a clear warning before sharing.
- **Semantic resume** can use the session `summary` + recent turns (free) or an SDK `query` digest
  (credit-aware, opt-in) — same pattern as Epic B meta-agent.

## 3. Architecture
### 3.1 GitManager (engine, tested) — shared with Epic A
`status(dir)`, `diff(dir, path?)`, `stage(dir, paths)`, `commit(dir, msg)`, `restore(dir, path|hunk)`.
Parsers (`status --porcelain`, unified diff) are pure and unit-tested.

### 3.2 Git integration in the changes panel (V1-5 deepening)
The changes panel (files the agent touched) gains: git status per file (modified/staged/untracked),
**stage** and **commit** actions, and a **diff** view. RPC: `sessionChangesGit(sessionId, dir)` joins
`buildChanges` with `git status`.

### 3.3 Inline diff editor
Click a changed file → unified diff (from `git diff`) with **accept/revert per hunk** (`git restore`
a hunk, or apply a reverse patch). Lower priority; commoditized.

### 3.4 Session compare/diff (pure, tested)
`compareSessions(a, b)` over two sessions' computed views → a structural diff:
tools used (added/removed), files changed (divergent), token/cost delta, outcome. UI: side-by-side.
This is the "which approach was better" view — pairs with fork (V1) and orchestration (Epic A).

### 3.5 Semantic resume
RPC `resumeBriefing(sessionId, dir)` → `{ recap, suggestedNext }` from summary + recent turns
(optionally SDK-augmented). Shown when reopening a session from the sidebar.

### 3.6 Replay / share
`buildReplay(sessionId, dir, { redact })` → a portable JSON bundle (ordered timeline + messages +
metadata, schema-versioned). A viewer (reuse the timeline UI; later the web client) re-opens it.
Redaction pass scrubs obvious secret patterns and warns.

### 3.7 Bookmarks
Pin a message/turn. Stored at `~/.glaudecode/bookmarks/<sessionId>.json` (engine, not in the session
file — never mutate Claude Code's JSONL). UI: a star on timeline entries + a bookmarks list.

## 4. Data model
```ts
interface GitStatusEntry { path: string; state: "modified"|"staged"|"untracked"|"deleted" }
interface FileDiff { path: string; hunks: { header: string; lines: string[] }[] }
interface SessionComparison { tools: { onlyA: string[]; onlyB: string[]; both: string[] };
  files: { onlyA: string[]; onlyB: string[]; both: string[] }; costDeltaUsd: number; tokenDelta: number }
interface ResumeBriefing { recap: string; suggestedNext: string }
interface ReplayBundle { version: 1; sessionId: string; entries: unknown[]; meta: Record<string, unknown> }
interface Bookmark { sessionId: string; messageId: string; note?: string; at: string }
```

## 5. Edge cases & failure modes
- **Not a git repo / detached state** → git features disable gracefully with a reason.
- **Hunk revert conflicts** (file changed since) → refuse + re-diff rather than corrupt.
- **Replay of a huge session** → cap/paginate; warn.
- **Redaction is best-effort** — explicit warning that it's not a guarantee before sharing.
- **Bookmarks reference a deleted session** → prune on session-delete.
- **Compare across different projects** → allowed but labeled.

## 6. Security
- Git writes (stage/commit/restore) are explicit user actions, never automatic.
- Replay redaction + a pre-share warning; nothing is uploaded by GlaudeCode (user shares the file).
- Bookmarks are local; never mutate Claude Code session files.

## 7. Test plan
- **Unit (pure):** `git status --porcelain` parser; unified-diff parser; `compareSessions`; replay
  bundle builder; redaction patterns; bookmark add/prune.
- **Integration:** GitManager against a temp repo (status/stage/commit/restore); resume briefing
  generation.
- **Manual:** inline diff accept/revert UX, side-by-side compare, replay re-open.

## 8. Acceptance criteria
- Changes panel shows git status and can stage + commit the agent's edits; diff per file.
- Inline diff editor reverts a hunk safely (refuses on conflict).
- Pick two sessions → meaningful side-by-side comparison (tools/files/cost).
- Reopening a session shows a useful recap + suggested next step.
- Export a session as a portable replay (with redaction + warning) and re-open it.
- Bookmark a turn; bookmarks persist and prune with the session.

## 9. Open questions (for review)
1. **Replay format** — GlaudeCode-native JSON vs aligning with Pi/Claude Code session schema for
   interop (ADR 0002 leaned toward interop). Recommend: native + a documented mapping.
2. **Inline diff priority** — confirm it's the lowest item in E (commoditized).
3. **Redaction depth** — regex secret-scan only, or integrate a secrets scanner? V2 = regex + warning.
