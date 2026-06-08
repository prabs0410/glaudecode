# Current State

**Last updated:** 2026-06-09 (V2 Epics A + B + C + D COMPLETE; Epic E next)
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
- **V2 Epic A — Orchestration (in progress, branch `feat/v2-a-orchestration`).** Per `docs/design/epic-a-orchestration.md`. Landed: A1 `WorktreeManager` (porcelain parser + git arg-array wrappers, tested), A2 `ConflictDetector` (pure path-overlap detection, tested), A3 multi-PTY registry (Rust core: `PtyRegistry` keyed by `paneId`; pane-scoped `pty_spawn/pty_write/pty_resize/pty_kill`; namespaced `pty-output:{paneId}`/`pty-exit:{paneId}` events; `cmd`/`args` so a pane hosts the shell or `claude --session-id <uuid>`), A4 orchestration UI — worktree+conflicts RPC, tabbed `Workspace` over N panes, "+ Claude" new-session flow (create worktree → mint uuid → `claude --session-id`), per-pane right-dock/status binding, sidebar live dots, non-blocking `ConflictBanner`, A5 context handoff (`buildHandoffSummary` pure digest + `handoff` RPC; UI pastes the digest into the target pane via bracketed paste — terminal-native, no live messaging). **Epic A done.**
- **V2 Epic B — Extensibility (COMPLETE, branch `feat/v2-b-extensibility`).** Per `docs/design/epic-b-extensibility.md`. B1 typed lifecycle `EventBus` (ADR-0002 taxonomy; `on()` disposer; `*` wildcard; handler-failure isolation). B2 jiti `ExtensionHost` — discovers `~/.glaudecode/extensions/*.ts` + repo-local, loads via jiti, `register(api)` with on/registerCommand/log; failure-isolated (bad/duplicate/throwing extension disables only itself); **trusted-only in-sidecar (documented; Worker isolation is a pre-1.0 gate)**. B3 advisory `MetaAgent` — rule-based cross-session observations (stuck/conflict/finished) via `generateObservations` (reuses ConflictDetector), off by default, $0 cost (SDK-query digests deferred), never acts; `metaObservations` RPC + opt-in `MetaAgentPanel` UI. Also fixed a handoff terminal-escape/bracketed-paste breakout (strip C0/C1 in `buildHandoffSummary`). Engine 104/104. **Epic B done.**
- **V2 Epic C — Cost & control (COMPLETE, branch `feat/v2-c-cost-control`).** Per `docs/design/epic-c-cost-control.md`. C1 `computeContextUsage` + status-bar `ctx NN%` gauge (warns near compaction). C2 smart approval: `classifyTool` policy (read-only auto-allow, risky→ask, catastrophic auto-deny), `ApprovalHookInstaller` (reversible `.claude/settings.json` merge), `ApprovalQueue` + `/approval` endpoint + `bin/approval-hook.ts` (fail-closed dangerous / fail-open read-only when engine unreachable), opt-in `ApprovalPanel` cards. C3 budgets: `aggregateDayCosts`/`evaluateBudget` pure + `CostStore` (~/.glaudecode rollups + budgets), `budgetStatus`/`get`/`set` RPCs, `BudgetChip` indicator (desktop-notification alerts deferred to Epic F). C4 `suggestModel` cheap-mode heuristic + `ModelSuggestionChip` (types `/model haiku`, review-first). Engine 154/154. **Epic C done.**
- **V2 Epic D — Memory & knowledge (COMPLETE, branch `feat/v2-d-memory-knowledge`).** Per `docs/design/epic-d-memory-knowledge.md`. D1 `parseLoadedContext` + `MemoryStore` (memory under ~/.claude/projects/<encoded>, AGENTS.md/CLAUDE.md read/write THROUGH the symlink, path-traversal-safe) + Memory dock tab (edit AGENTS.md/memory + loaded-context view). D2 `mapGraphJson` + `GraphManager` (graphify subprocess, optional — degrades to an enable-guide) + Graph dock tab. D3 `SearchIndex` (SQLite FTS5 with bm25/snippet, LIKE fallback, huge-session cap) + reindex/search RPCs (evict on delete) + sidebar `GlobalSearch` (content search → jump to session). Added `jiti` (B2) + uses built-in `bun:sqlite` (no new dep). Engine 175/175; Rust + desktop tsc clean; vite build green. Next: Epic E — Session tooling (`docs/design/epic-e-session-tooling.md`): E1 GitManager, E2 git-in-changes ⭐, E3 inline diff, E4 session compare ⭐, E5 semantic resume, E6 replay/share ⭐, E7 bookmarks.
- **Not yet done**: branches unpushed/unmerged (PRs blocked on prabs0410 gh auth — see memory); visual review of the panels pending; V1-4 cost price table is a best-effort estimate.

## Next

What comes after current work. Concrete, not aspirational.

- **First real feature on the skeleton** — wire the Bun/Agent-SDK engine (proven `listSessions`/`getSessionMessages`) into a sessions sidebar beside the terminal pane, via the ClaudeCodeAdapter. This is the first vertical slice of the actual product.
- **Push** the skeleton + spike commits to `origin/main`.
- **Discovery research** — focused pass to find what none of opcode/Anthropic/Wave/Terax does (the felt-improvement wedge per Principle II). Can run in background.
- **Re-evaluate the 9 features** against Principle II's felt-improvement bar; drop commoditized ones as standalone differentiators.
- **Cosmetic** — rename window title "desktop" → GlaudeCode (`tauri.conf.json` productName).
- **Open questions** — `docs/open-questions.md`.
