# AGENTS.md — GlaudeCode

## Interaction Rules

1. **Ask, Don't Assume** — Use AskUserQuestion tool for ANY confusion, doubt, decision point, or need for clarity. Never guess. Never assume. Always ask first.
2. **Think Simple** — Don't overcomplicate. Don't oversimplify. Find the honest middle ground. Be reliable and responsible in every recommendation.
3. **No AI Co-Author Tags** — No "Co-Authored-By: Claude" or Anthropic attribution in commit messages.
4. **Maximize AskUserQuestion Usage** — Ask proactively to confirm direction, validate assumptions, and clarify ambiguity before proceeding.
5. **Verify Before Acting** — Never assume anything is safe to use, modify, or delete. When uncertain, say so.

> **Cross-tool agent memory.** Read by Codex CLI, Cursor, Windsurf, GitHub Copilot natively.
> Claude Code reads `CLAUDE.md` (symlinked to this file).

## Project

**GlaudeCode** — the terminal built to make Claude Code exceptional. A desktop terminal (Tauri 2 + React + xterm.js + Bun-sidecar engine), deeply integrated with Claude Code, that makes everyday Claude Code work more powerful, visible, and controllable. Competes on integration depth, not as a meta-layer. See `docs/adr/0003` (positioning) and `docs/adr/0004` (architecture).

## Status

✅ V1 + V2 (epics A–G) + V3 (terminal polish A–E) all built, tested, committed on stacked `feat/*` branches (nothing pushed — PRs blocked on `prabs0410` gh auth). Full record: [`docs/BUILD-LOG.md`](docs/BUILD-LOG.md); live status: [`docs/state.md`](docs/state.md).

## Current focus

Polish/correctness on the running app. No active backlog in [`docs/GOAL.md`](docs/GOAL.md) (a V4 would be a new section). See [`docs/state.md`](docs/state.md).

## How to work in this repo

- Specs live in `.specify/specs/`. One folder per feature.
- Run `/speckit.constitution` first (locks non-negotiables)
- Then `/speckit.specify` → `/speckit.clarify` → `/speckit.plan` → `/speckit.tasks` → `/speckit.implement`
- Use `Skill writing-plans` (Superpowers) for non-trivial features before implementing
- Run `pr-review-toolkit` before opening PRs
- Use `/commit-push-pr` to finalize

## Build, test & gotchas (learned in the build)

- **Verify**: `cd packages/engine && bun test` (255+ tests) · `bunx tsc --noEmit` per package · `bunx vite build` (desktop) · `cargo build` in `packages/desktop/src-tauri`. Run the app: `cd packages/desktop && bun run tauri dev`.
- **Run `git` from the repo root** — `cd`-ing into a package then `git add packages/...` doubles the path (`pathspec did not match`).
- **`cargo build` lies when cached** ("Finished 0.4s"); the `tauri dev` watcher already built it — `touch src/lib.rs && cargo build` to actually confirm a Rust change compiles.
- **Engine changes need an app restart** (the Bun sidecar respawns on launch); vite HMR only reloads the WebView. Engine ships as a Bun *script* — `bun build --compile` breaks the Agent SDK (#150).
- **Pure logic lives in `@glaudecode/engine` (tested);** a few fns are mirrored verbatim in `packages/desktop/src/{fuzzy,keybindings,osc,notify}.ts` (the WebView can't import the engine — it pulls the Node-only SDK). Change both.
- **New engine RPC** = `RpcMethod` union + `METHODS` set + dispatch case in `rpc.ts` + classify its scope (`VIEW_METHODS` / `LOCAL_ONLY_METHODS`; unlisted defaults to `steer`) + client wrapper in `desktop/src/engine.ts` + export from `index.ts`.
- **New Tauri plugin** = `cargo add` + `.plugin(..init())` in `lib.rs` + add the permission to `src-tauri/capabilities/default.json` (the capability is the forgettable step).
- **Stranded agent?** Every Bash/Edit/Write denied with `engine unreachable — denied (fail-closed)` = the smart-approval `PreToolUse` hook is gating you → `rm .claude/settings.json` from a *separate* terminal (it holds only our hook).

## Structure & load-bearing patterns

- **`packages/engine`** — host-agnostic Bun library. Pure session-computation logic (parsers, cost, conflict/agent-state derivation, etc.) lives here and is unit-tested; exposed over a localhost HTTP/WS RPC the WebView calls. **`ClaudeCodeAdapter` is the ONLY point that touches Claude Code** (Agent SDK APIs, never raw `~/.claude` JSONL, no tight polling) — Constitution Principle XI.
- **`packages/desktop`** — Tauri 2 app. The **Rust core owns the PTY** (`PtyRegistry`, pane-keyed) and spawns the engine as a Bun **sidecar**, reading a `{port, token}` handshake. The **React WebView only renders**; it reaches the engine over the localhost RPC, which **pins CORS to the WebView origin**.
- Gotcha: **no React `StrictMode`** in `main.tsx` (it double-spawns PTYs).

## Documentation Index

**Where we are right now:** [`docs/state.md`](docs/state.md). Open this first when starting a session — it has Locked / In flight / Next sections updated continuously. For the full doc map, see [`docs/INDEX.md`](docs/INDEX.md).

**Single source of truth: [`docs/INDEX.md`](docs/INDEX.md).** Open this file before searching the repo for documentation. Every doc under `docs/` is listed there with purpose, naming convention, and current contents.

Quick map (full details in INDEX.md):

| Folder | What lives there |
|---|---|
| `docs/adr/` | Architectural Decision Records (numbered, immutable) |
| `docs/architecture/` | Long-form system design |
| `docs/research/competitive/` | Competitor analysis (e.g., Pi) |
| `docs/research/market/` | TAM, users, pricing research |
| `docs/research/technical/` | Library/framework evaluation, spikes |
| `docs/guides/user/` | End-user how-tos |
| `docs/guides/contributor/` | Contributor how-tos |
| `docs/api/` | Public surface reference (CLI, config, hooks, AGENTS.md format) |
| `docs/runbooks/` | Operational playbooks (heartbeat, release, incident) |
| `docs/marketing/` | Build-in-public artifacts (heartbeat archive, launch posts) |

Authoritative locations OUTSIDE `docs/` (do NOT duplicate):
- `.specify/memory/constitution.md` — the constitution
- `.specify/specs/` — feature specifications
- `README.md`, `LICENSE`, `NOTICE` — public-facing + legal
- `AGENTS.md` (this file, symlinked to `CLAUDE.md`)

**Rule**: every new file added under `docs/` MUST be listed in `docs/INDEX.md` in the same commit. This is enforced by Constitution Principle IX (specs touching the project's documentation surface must keep memory and index current).

## Git identity (LOAD-BEARING — verify before every commit)

**Commits in this repo MUST attribute to GitHub user `prabs0410`, not `ashinclude` (the user's primary account).** This is enforced by **local** git config in `.git/config`. Do NOT change the global git config — other repos still attribute to `ashinclude` intentionally.

Local config for this repo:

```
user.name  = Prabhakaran R
user.email = 192090657+prabs0410@users.noreply.github.com
```

**Transport**: the `origin` remote uses the `github-personal` SSH alias defined in `~/.ssh/config`, which routes through the PEM key `~/.ssh/id_personal`. That key is registered with `prabs0410` on GitHub. The remote URL must remain `git@github-personal:prabs0410/glaudecode.git` — never `git@github.com:...` (which would route through the default key for `ashinclude`).

**Before every commit**, verify:

```
git config --local user.email   # must report the +prabs0410@users.noreply.github.com address
git remote -v                   # origin must use github-personal alias
```

If a commit ever lands as `ashinclude` on GitHub, that is a bug. Fix the local config and rewrite the affected commit(s) (`git filter-branch` or `git commit --amend` for the most recent one) before pushing further work. Coordinate with the user before any force-push.

## Stack

- Spec-Kit for spec → tasks → issues pipeline
- Superpowers for engineering discipline (TDD, planning, debugging)
- Anthropic-official plugins: feature-dev, pr-review-toolkit, code-review, commit-commands, security-guidance

## Out of scope (deferred)

- BMad-style multi-agent role play
- Auto-iteration loops (ralph-loop and similar)
- Hosted/managed tunnel tier (the OSS cockpit is "view+steer" behind the user's own transport)

(Note: the web/mobile **cockpit** shipped as Epic G and the **graphify** knowledge graph as Epic D — both were previously listed here as deferred.)
