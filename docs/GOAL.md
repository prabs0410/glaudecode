# GlaudeCode — Goal & Autonomous-Build Backlog

> This file is the single target an autonomous build loop works against. It pairs the north-star
> with a structured, testable V1 backlog and the hard guardrails any automated agent MUST obey.
> Status of the foundation: VERIFIED (Tauri+xterm.js+PTY runs Claude Code; Agent SDK reads/forks
> sessions — see `docs/research/technical/spike-*.md`).

---

## North-Star

**GlaudeCode is the open, terminal-native home for Claude Code: a desktop terminal you actually
live in, built so that everyday Claude Code work becomes visible, controllable, and orchestratable
instead of scattered and opaque.**

It wraps Claude Code in a terminal that *shows you the work* — live agent state, the tool-call
timeline, the thinking, the files being changed, the tokens and cost as they accrue — and lets you
*act on it* with precise approval, steering, and a fast command palette without breaking the
session's flow. Beyond one session it is a *command center*: it runs and coordinates many Claude
Code sessions across git worktrees, warns when they collide, hands context between them, and lets
you find, name, fork, and resume any session you've run. It *remembers your work* via searchable
history, surfaced memory, and an optional knowledge graph, and lets you *reach your sessions from
anywhere* — browser or phone. It stays *open and hackable* (Apache-2.0, lifecycle hooks, jiti TS
extensions). It is not a replacement for Claude Code and not a neutral layer above it — it is the
terminal *designed for* Claude Code, competing on integration depth.

**Success test:** someone who has used GlaudeCode for a week can't imagine running Claude Code in
a plain terminal again.

**The one filter every feature passes (Constitution Principle II):** *does this make a Claude Code
user's work meaningfully better than the terminal they have now?* If it only re-skins what Claude
Code's own app or opcode already do well, it does not ship.

---

## V1 Scope — "The terminal where you can SEE what Claude Code is doing"

Six features. All on data proven feasible in the spikes. Ordered by dependency. Each is an
independently shippable vertical slice with explicit acceptance criteria and a test requirement.

> Build order is top-to-bottom. Each item = one or more PRs. Definition of done for EVERY item:
> code + tests pass + `pr-review-toolkit` clean + AGENTS.md/docs updated (Principle IX) + the
> acceptance criteria below are demonstrably met.

### V1-0 — Engine package + ClaudeCodeAdapter (foundation, blocks everything)
- **What:** `packages/engine` — host-agnostic TS lib. `ClaudeCodeAdapter` wrapping the Agent SDK
  (`listSessions`, `getSessionMessages`, `getSessionInfo`, `forkSession`, `renameSession`,
  `tagSession`). Runs as a Bun sidecar the Tauri core spawns; exposes a typed RPC to the WebView.
- **Acceptance:** desktop app starts the sidecar; a typed `engine.listSessions()` call from the
  renderer returns the real sessions for the current project. All Claude Code access goes through
  the adapter (Principle XI) — no raw `~/.claude/projects` JSONL parsing anywhere.
- **Tests:** engine unit/integration tests against a real session fixture; adapter contract test.

### V1-1 — Sessions sidebar (entry fee, done terminal-native)
- **What:** a sidebar beside the terminal listing sessions with title, last-active, git branch,
  cwd; click to view; fast fuzzy search/filter; rename + tag + delete.
- **Acceptance:** sidebar shows real sessions within 200ms of open; search filters live; rename/tag
  persist; selecting a session shows its summary. No tight `listSessions()` polling (event/debounce
  only — Principle XI / SDK #268).
- **Tests:** component tests for list/search/rename; engine test for the data path.

### V1-2 — Agent-state status bar (DIFFERENTIATED)
- **What:** a status bar showing the active session's live state — `idle / thinking / running tool
  <name> / waiting for approval` — with an elapsed timer and current model.
- **Acceptance:** state transitions reflect the real session within ~1s; elapsed timer runs;
  model name correct. Driven by the session message stream, not screen-scraping.
- **Tests:** state-machine unit tests over a recorded session stream fixture.

### V1-3 — Tool-call timeline + thinking panel (DIFFERENTIATED)
- **What:** a collapsible panel listing every tool call (name + inputs + result status) and the
  agent's extended-thinking blocks, in order, for the active session.
- **Acceptance:** every `tool_use` and `thinking` block in the session renders in order; long
  entries collapse; updates live as the session progresses.
- **Tests:** render tests over a fixture session containing tool_use + thinking blocks.

### V1-4 — Live token/cost counter
- **What:** running token count (from `message.usage`) and a computed USD estimate (tokens ×
  model price table — interactive sessions do NOT include cost; we compute it) for the active
  session, shown in the chrome.
- **Acceptance:** token count matches the session; cost is a clearly-labeled estimate; updates live.
- **Tests:** cost-calculation unit tests against known token counts + a price table.

### V1-5 — Persistent changes panel
- **What:** a panel listing every file the agent created/modified this session (from
  `file-history-snapshot` data), with quick open.
- **Acceptance:** the file list matches what the session actually touched; clicking opens the file;
  updates live.
- **Tests:** engine test mapping file-history-snapshot → file list over a fixture.

**V1 STATUS: COMPLETE (2026-06-09).** All six features built, tested (engine 56/56), committed on
branch `feat/v1-0-engine-adapter`. Architecture: pure session-computation logic in
`@glaudecode/engine` (tested) exposed via RPC computed server-side; the WebView renders.

---

## V2 Scope — "The terminal you can run many agents in and walk away from"

Everything in the previously-discussed feature set that V1 did not already deliver. Ordered by
dependency and value (foundational + differentiated first; the cockpit last because it is the
biggest). Same definition of done and guardrails as V1: each item is a branch + PR, tests gate
the PR, all Claude Code access stays behind the ClaudeCodeAdapter (Principle XI), build in order.

### V2-1 — Multi-session orchestration (foundational; build in three slices)
- **V2-1a Worktree-paired sessions:** spawn and track multiple `claude` processes, one per git
  worktree, each isolated in its own session directory (avoids the contamination bug). UI: tabs or
  panes to switch between live sessions. *Acceptance:* run ≥2 sessions across worktrees at once,
  each independent, switchable.
- **V2-1b Cross-session conflict detection ⭐:** warn when two live sessions touch the same file
  (from their changes streams). *Acceptance:* a visible warning when two sessions edit one path.
- **V2-1c Context handoff:** extract a summary/artifact from one session and inject it as context
  into another (via fork/resume-with-context — no live messaging). *Acceptance:* hand one
  session's result into another on demand.

### V2-2 — Lifecycle hooks + jiti extensions ⭐ (the hackable/OSS foundation)
Engine EventBus emits lifecycle events (session start/fork/switch/compact + GC's cross-session
events per ADR 0002); a jiti-based loader runs user `.ts` extensions in the Bun sidecar.
*Acceptance:* a sample extension reacts to a real session event.

### V2-3 — Meta-agent (advisory watcher) ⭐
A background loop (engine, via SDK `query` — costs SDK credits) reads active sessions and surfaces
observations ("session 3 stuck 5 min", "1 & 4 edit same file", "2 finished"). Advisory only.
*Acceptance:* surfaces ≥1 real cross-session observation; clearly never acts autonomously.

### V2-4 — Knowledge graph (graphify) ⭐
Spawn graphify (Python) over the project, read `graph.json`, render it in a panel. *Acceptance:*
the project's graph renders; bundled-Python dependency documented.

### V2-5 — Memory tab + in-app AGENTS.md editor ⭐
Surface and edit project memory + `AGENTS.md`; show what's actually loaded into context.
*Acceptance:* view + edit memory/AGENTS.md from the app; edits persist to disk.

### V2-6 — Context-window gauge ⭐
Show how full the context is and warn before auto-compaction. *Acceptance:* a live gauge reflecting
the selected session's context usage with a pre-compaction warning.

### V2-7 — Smart approval pane ⭐
Surface tool approvals without breaking the output stream; policy to auto-approve read-only tools
and always-ask dangerous ones (`rm`, `push`). *Acceptance:* approve/deny a tool call from the pane;
policy honored.

### V2-8 — Prompt library + slash-command builder ⭐
Save, template, search prompts; build custom slash commands. *Acceptance:* save and reuse a
templated prompt; define a working custom slash command.

### V2-9 — Session compare / diff (side-by-side) ⭐
Diff two sessions/runs side by side (what changed between attempts). *Acceptance:* pick two
sessions and see a meaningful side-by-side comparison.

### V2-10 — Semantic resume
On reopening a session, generate "here's what you were doing and the likely next step" (V1 already
delivers session discovery/continue). *Acceptance:* a useful AI summary on resume.

### V2-11 — Session replay / share ⭐
Export a session as a portable, shareable replay file (teaching, PRs, build-in-public).
*Acceptance:* export + re-open a replay that reproduces the session view.

### V2-12 — Inline diff editor
Accept/revert hunks for the agent's changes in the changes panel. *Acceptance:* view and revert a
hunk. (Commoditized — lower priority within V2.)

### V2-13 — Command palette + keybindings
Cmd-K fuzzy actions over app commands; configurable keybindings. *Acceptance:* invoke core actions
from the palette; rebind a key.

### V2-14 — Web + mobile cockpit (largest; last)
Expose the engine's RemoteServer beyond localhost (auth + transport the user provides) and ship a
web client (PWA) reused on mobile to view/steer running sessions. *Acceptance:* view and steer a
session from a browser, and from a phone browser, against the local engine.

**Differentiation note (Principle II):** the sharpest cluster is V2-1 + V2-3 + V2-6 + V2-7 — the
"run many agents and walk away" capability neither Anthropic's app nor opcode delivers. Build it
well; don't let any item drift into a generic re-skin of what incumbents already do.

---

## Autonomous-Build Guardrails (an automated agent MUST obey ALL of these)

1. **Branch + PR only.** Never commit directly to `main`. Each work item → a feature branch → a PR.
2. **Tests gate the PR.** No PR is opened unless the build passes and the item's tests pass.
3. **Never destructive.** Never force-push, never rewrite `main` history, never delete user data or
   sessions, never modify the git identity / `.git/config` / remote (Principle: git identity is
   load-bearing — commits MUST stay `prabs0410`).
4. **Respect the adapter rule (Principle XI).** All Claude Code access via `ClaudeCodeAdapter` +
   SDK APIs; no raw JSONL parsing; no tight polling.
5. **One item at a time, in order.** Follow the V1 build order; do not start V1-N+1 until V1-N's PR
   exists and is green.
6. **Stop on repeated failure.** After 2 consecutive failed attempts on an item, STOP and leave a
   clear note for human review rather than thrash.
7. **Keep docs honest (Principle IX).** Every PR updates AGENTS.md / `docs/INDEX.md` / `docs/state.md`
   as relevant, in the same PR.
8. **Felt-improvement filter (Principle II).** If an item drifts into generic re-skinning of what
   Anthropic's app / opcode already do, stop and flag — do not ship the commoditized version.

### The one human knob
- **Auto-merge to `main`:** OFF by default (PRs stay open for human approval). May be turned ON by
  the founder for fuller autonomy — recorded here when set: **[ currently OFF ]**.

---

## How this gets executed (the loop)
The backlog above becomes the work queue (optionally pushed to GitHub issues via Spec-Kit
`/speckit.taskstoissues`). An autonomous loop (e.g. ralph-loop, or `/loop` over a build command)
picks the next open item, implements it on a branch under the guardrails, runs tests + review,
opens a PR, and continues. The founder kicks off the loop and reviews PRs.

**Honest note (recorded with founder's informed consent, 2026-06-08):** maximum autonomy on a
taste-dependent product carries real risk of building the commoditized version well while missing
the differentiation that is the entire moat. The guardrails above bound the *damage*, not the
*judgment*. Human PR review is the safety valve; skipping it (auto-merge ON) raises that risk.
