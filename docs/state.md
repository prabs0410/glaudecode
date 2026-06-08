# Current State

**Last updated:** 2026-06-09 (V2 Epic A in progress — A1/A2/A3 landed)
**Update protocol:** Refresh the three sections below at the end of every meaningful work unit. Stale state is worse than no state — if a section is unchanged for >2 working sessions, prune it.

---

## Locked

Things decided. Don't relitigate. Cross-reference where it lives.

- **Positioning** — "The terminal built to make Claude Code exceptional." Integration depth, NOT meta-layer. ADR 0003.
- **Constitution v2.0.0** — `.specify/memory/constitution.md`. Principles I/II/X redefined, XI (Foundation Risk) added. Ratified 2026-05-18, amended 2026-06-01.
- **Stack** — Tauri 2 (Rust core) + React/TS + Zustand + xterm.js (WebGL) + portable-pty + Bun-sidecar TypeScript engine + Agent SDK. ADR 0004.
- **Build, don't fork** — study Terax + Wave (both Apache-2.0); own the UI. ADR 0004.
- **ClaudeCodeAdapter mandatory** — all Claude Code integration behind one module; read via SDK APIs not raw JSONL; no tight polling; one session per worktree dir. Principle XI / ADR 0004.
- **Pi-inspired data conventions** — ADR 0002 (JSONL tree, lifecycle events, fork verbs, steering, jiti extensions). Still in force.
- **Apache 2.0** — Principle IV.
- **Proceed-in-crowded-space decision** — made knowingly twice (2026-05-21, 2026-06-01). Evidence: `docs/research/competitive/viability-2026.md`. Memory: `project-proceed-decision-crowded-space`.
- **Git identity** — local config `192090657+prabs0410@users.noreply.github.com`, SSH `github-personal`. AGENTS.md "Git identity".

## In flight

Active work. Things touched in the current or last working session.

- **V1 COMPLETE (2026-06-09).** All six features in `docs/GOAL.md` built, tested, committed on branch `feat/v1-0-engine-adapter`: V1-0 engine+adapter, V1-0b sidecar wiring, V1-1 sessions sidebar (search/rename/tag/delete), V1-2 agent-state status bar, V1-3 tool-call timeline + thinking panel, V1-4 token/cost counter, V1-5 changes panel + tabbed right dock. Engine 56/56 tests pass; engine + desktop tsc clean; frontend production-build succeeds.
- **Architecture pattern in use**: pure session-computation logic lives in `@glaudecode/engine` (tested) and is exposed via RPC methods (agentState/timeline/sessionCost/sessionChanges) computed server-side; the WebView just renders. ClaudeCodeAdapter is the sole Claude Code access point (Principle XI).
- **V2 Epic A — Orchestration (in progress, branch `feat/v2-a-orchestration`).** Per `docs/design/epic-a-orchestration.md`. Landed: A1 `WorktreeManager` (porcelain parser + git arg-array wrappers, tested), A2 `ConflictDetector` (pure path-overlap detection + `conflicts` RPC, tested), A3 multi-PTY registry (Rust core: `PtyRegistry` keyed by `paneId`; pane-scoped `pty_spawn/pty_write/pty_resize/pty_kill`; namespaced `pty-output:{paneId}`/`pty-exit:{paneId}` events; `cmd`/`args` so a pane hosts the shell or `claude --session-id <uuid>`). Engine 65/65; Rust + desktop tsc clean. Next: A4 orchestration UI (tabs/panes + new-session-in-worktree + conflict banner), A5 context handoff.
- **Not yet done**: branches unpushed/unmerged (PRs blocked on prabs0410 gh auth — see memory); visual review of the panels pending; V1-4 cost price table is a best-effort estimate.

## Next

What comes after current work. Concrete, not aspirational.

- **First real feature on the skeleton** — wire the Bun/Agent-SDK engine (proven `listSessions`/`getSessionMessages`) into a sessions sidebar beside the terminal pane, via the ClaudeCodeAdapter. This is the first vertical slice of the actual product.
- **Push** the skeleton + spike commits to `origin/main`.
- **Discovery research** — focused pass to find what none of opcode/Anthropic/Wave/Terax does (the felt-improvement wedge per Principle II). Can run in background.
- **Re-evaluate the 9 features** against Principle II's felt-improvement bar; drop commoditized ones as standalone differentiators.
- **Cosmetic** — rename window title "desktop" → GlaudeCode (`tauri.conf.json` productName).
- **Open questions** — `docs/open-questions.md`.
