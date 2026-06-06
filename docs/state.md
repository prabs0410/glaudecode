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

- **Working skeleton built + foundation VERIFIED end-to-end (this session).** `packages/desktop` — Tauri 2 + React + xterm.js + portable-pty. Built, launched, and Claude Code's TUI renders correctly inside our terminal (visual evidence). Both architecture halves now proven: SDK read/fork (`spike-claude-code-integration.md`) + terminal rendering (`spike-tauri-terminal-rendering.md`). Committing the skeleton now.
- **Monorepo root** — `package.json` with bun workspaces + `desktop` script, per ADR 0004.

## Next

What comes after current work. Concrete, not aspirational.

- **First real feature on the skeleton** — wire the Bun/Agent-SDK engine (proven `listSessions`/`getSessionMessages`) into a sessions sidebar beside the terminal pane, via the ClaudeCodeAdapter. This is the first vertical slice of the actual product.
- **Push** the skeleton + spike commits to `origin/main`.
- **Discovery research** — focused pass to find what none of opcode/Anthropic/Wave/Terax does (the felt-improvement wedge per Principle II). Can run in background.
- **Re-evaluate the 9 features** against Principle II's felt-improvement bar; drop commoditized ones as standalone differentiators.
- **Cosmetic** — rename window title "desktop" → GlaudeCode (`tauri.conf.json` productName).
- **Open questions** — `docs/open-questions.md`.
