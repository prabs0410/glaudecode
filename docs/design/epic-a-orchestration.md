# Epic A — Multi-Session Orchestration

**Status:** Draft for review
**Depends on:** V1 (engine, adapter, PTY bridge, the four computed-view RPCs)
**Blocks:** Epic B meta-agent (needs multiple live sessions), Epic C conflict-aware control

## 1. Problem & user value

Today GlaudeCode runs **one** PTY with one `claude`. The whole "walk away and trust it" thesis —
the differentiation the viability research identified — requires running **several** Claude Code
sessions at once, each on its own git worktree, visible and switchable in one window, with a warning
when two of them touch the same file, and the ability to hand one session's result into another.

**Felt-improvement test (Principle II):** Anthropic's app added worktree-isolated parallel sessions,
and Claude Code has native worktree support — so "run parallel sessions" alone is *not* a
differentiator. Our wedge is the **terminal-native** version plus the two things neither does:
**cross-session conflict detection** and **explicit context handoff**. Build those well; the rest is
table stakes we must match cleanly.

## 2. Research

- **Claude Code has native worktree support** ([docs](https://code.claude.com/docs/en/worktrees)):
  each session in its own worktree isolates edits. We orchestrate *on top* of this, we don't
  reinvent it.
- **Operator pattern** ([MindStudio](https://www.mindstudio.ai/blog/parallel-agentic-development-git-worktrees)):
  one supervising process spins up worker agents, each in a worktree, monitors them, collects
  results. That is exactly GlaudeCode's role.
- **Practical limit is 2–4 parallel agents** (memory/CPU/rate-limits). Beyond that, coordination
  overhead outweighs parallelism. → Our UI should make 2–4 first-class; not optimize for dozens.
- **Decompose by feature/domain; avoid splitting work that touches the same files.** → This is
  precisely why **conflict detection** is valuable: it catches the anti-pattern the moment it happens.
- **xterm.js WebGL contexts cap at ~8–16** ([xterm #4379](https://github.com/xtermjs/xterm.js/issues/4379)).
  At 2–4 panes we are far under the cap; we keep WebGL per visible pane and can fall back to canvas
  for backgrounded panes if we ever exceed it.
- **No live inter-session messaging** (confirmed earlier): the only mechanism is fork/resume with
  injected context. Context handoff MUST use that, not a fictional "send to running session."

## 3. Architecture

### 3.1 Rust core — from single PTY to a session-keyed PTY registry
V1's `PtyState` holds one writer/master. Replace with a registry keyed by a `paneId`:

```rust
struct PtyRegistry { panes: Mutex<HashMap<String, PaneHandle>> }  // paneId -> handle
struct PaneHandle { writer: Box<dyn Write + Send>, master: Box<dyn MasterPty + Send> }
```

Commands become pane-scoped: `pty_spawn(paneId, cwd, cmd, rows, cols)`, `pty_write(paneId, data)`,
`pty_resize(paneId, rows, cols)`, `pty_kill(paneId)`. Output events are namespaced:
`pty-output:{paneId}` / `pty-exit:{paneId}`. `cmd` is `claude` (or the shell) so a pane can host a
shell *or* a Claude session.

### 3.2 Engine — WorktreeManager (new module, tested)
Wraps `git` via argument arrays (never string interpolation — injection-safe):
- `listWorktrees(repoDir)` → parse `git worktree list --porcelain` → `WorktreeInfo[]`.
- `createWorktree(repoDir, branch)` → `git worktree add <path> -b <branch>` under a managed dir
  (e.g. `<repo>/.glaudecode/worktrees/<branch>`).
- `removeWorktree(path)` → `git worktree remove` (guard: refuse if dirty unless forced).

### 3.3 Engine — SessionRegistry + pane↔session mapping
A pane that runs `claude` must be tied to a Claude Code **session id** so the V1 panels
(agentState/timeline/cost/changes) can show *that pane's* data. Mapping strategy (see Open Questions
— this is the crux):
- **Preferred:** spawn `claude --session-id <uuidWeGenerate>` if the CLI supports assigning a new
  id. Deterministic.
- **Fallback:** spawn `claude` in worktree dir `D`, then `listSessions({dir: D})` and take the
  session whose `createdAt` is newest-after-spawn. Heuristic; works because each worktree dir is its
  own session bucket.

### 3.4 Engine — ConflictDetector (pure, tested)
Given the active panes' session ids + dirs, fetch each session's `buildChanges` (already in V1) and
compute path overlaps:
```
detectConflicts(perSessionChanges: { sessionId, changes: ChangeEntry[] }[]) : ConflictWarning[]
```
A conflict = the same absolute path appears in ≥2 sessions' change sets. Pure function → unit-tested.

### 3.5 Engine — context handoff
`handoff(fromSessionId, toSessionId | newWorktree, dir)`:
1. Summarize `from` (use its existing `summary`/last assistant text, or a short generated digest).
2. Start/resume `to` with that summary injected as the opening context (fork/resume-with-prompt).
No live messaging. Exposed as an RPC; the UI offers "hand off to…".

### 3.6 UI
- **Workspace = N panes** (tabs first; split-view later). Each pane = `<TerminalPane paneId>` +
  the right dock bound to that pane's session id.
- **"New session" flow:** pick/create a worktree → spawn `claude` there → map to a session → new pane.
- **Conflict banner:** non-blocking warning naming the file + the two sessions.
- Sidebar (V1) gains a "live" indicator for panes currently running.

## 4. Data model (added to `@glaudecode/engine`)
```ts
interface WorktreeInfo { path: string; branch?: string; head?: string; isMain: boolean; locked: boolean }
interface Pane { paneId: string; kind: "shell" | "claude"; worktreePath: string; sessionId?: string }
interface ConflictWarning { path: string; sessionIds: string[] }
```

## 5. Edge cases & failure modes
- **Worktree dirty on remove** → refuse + surface, offer force.
- **`claude` not found / fails to start** → pane shows the error; no silent failure.
- **Pane↔session mapping misses** (fallback heuristic picks the wrong session) → let the user
  re-bind a pane to a session manually; show the bound id.
- **Session id changes mid-run** (compaction/fork by claude) → re-resolve via newest-in-dir.
- **Killing a pane mid-tool** → kill PTY; the JSONL is preserved (engine reads are unaffected).
- **>4 panes** → still works, but warn about resource/rate-limit cost; lazy-mount WebGL for visible panes.
- **Two panes on the *same* worktree** → disallow by default (re-introduces the contamination bug);
  one claude session per worktree dir.

## 6. Security
- All `git` calls use arg arrays (no shell). Worktree paths confined under `<repo>/.glaudecode/`.
- `claude` spawned with explicit `cwd` + inherited env; no extra privileges.
- Conflict detection reads only via the adapter (Principle XI).

## 7. Test plan
- **Unit (pure):** `WorktreeManager` porcelain parser; `ConflictDetector` overlap logic; handoff
  summary selection.
- **Integration:** spawn a real `claude` in a temp worktree; assert pane↔session mapping resolves;
  RPC round-trips.
- **Manual/visual:** multi-pane layout, switching, conflict banner rendering, handoff UX.

## 8. Acceptance criteria
- Run **≥2** Claude sessions across **≥2** worktrees concurrently, each isolated, switchable.
- Each pane's right dock + status bar show **that pane's** real agentState/timeline/cost/changes.
- A visible, accurate **conflict warning** when two live sessions modify the same file.
- **Hand off** one session's result into another on demand (via fork/resume).

## 9. Open questions (for review)
1. **Pane↔session id binding — RESOLVED (2026-06-09 spike):** `claude --session-id <uuid>` IS
   supported ("Use a specific session ID for the session"). We generate the uuid, spawn
   `claude --session-id <uuid>` in the worktree PTY, and bind the pane to it deterministically — no
   heuristic, no manual rebind needed. Also confirmed available: `--name`, `--model`,
   `--permission-mode`, `--fork-session`, `--resume`, `--continue` (useful for Epics C/E).
2. **Tabs vs split-panes for V2-1a** — start tabs (simpler), add split later? (Recommended: tabs first.)
3. **Worktree home** — `<repo>/.glaudecode/worktrees/` vs a user-config path? (Recommended: under repo,
   gitignored.)
4. **Conflict cadence** — recompute on each changes-poll (2s) or debounce harder to limit `getSessionMessages` load?
