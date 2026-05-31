# Current State

**Last updated:** 2026-06-01 (post positioning pivot + architecture lock)
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

- **Docs/ADRs alignment (this session)** — ADR 0003 (positioning), ADR 0004 (architecture) written; constitution → v2.0.0; README rewritten; this file refreshed; INDEX updated. Committing now.
- **AGENTS.md** — still has earlier uncommitted edits (interaction rules, Git identity, Documentation Index, state pointer) AND still says "meta-layer" in its Project line — needs the positioning fix folded in.
- **Unpushed commits** to `origin/main`: working-memory artifacts (`72f3fa5`) + Pi/docs-scaffold commits, plus this alignment commit about to land.

## Next

What comes after current work. Concrete, not aspirational.

- **Fix AGENTS.md "Project" line** to the new positioning + commit AGENTS.md's pending edits.
- **Push** all unpushed commits to `origin/main`.
- **Validation spike** — bare Tauri + xterm.js + portable-pty running real `claude`, PLUS the three Principle XI risk-tests: (a) Bun sidecar reads an interactively-created session via SDK; (b) fork/resume works on it; (c) sidecar packaging survives the `bun build --compile` SDK issue (#150) or ship plain Bun. This proves/kills the foundation.
- **Discovery research** — focused pass to find what none of opcode/Anthropic/Wave/Terax does (the felt-improvement wedge per Principle II). Can run in background.
- **Re-evaluate the 9 features** against Principle II's felt-improvement bar; drop commoditized ones as standalone differentiators.
- **Open questions** — `docs/open-questions.md`.
