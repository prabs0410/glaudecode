# ADR 0004 — System Architecture

**Status:** Accepted
**Date:** 2026-06-01
**Decision owner:** Prabhakaran R (solo founder)
**Depends on:** ADR 0002 (data-model conventions), ADR 0003 (positioning, Principle XI)

## Context

GlaudeCode is a desktop terminal emulator deeply integrated with Claude Code (ADR 0003). The
stack and shape were decided across the 2026-05/06 research sessions and validated against two
shipping reference apps in the same category: **Terax** (Tauri + React + xterm.js, Apache-2.0)
and **Wave Terminal** (Electron + React + Go, Apache-2.0). The Claude Code integration substrate
is verified-unstable (ADR 0003 Principle XI), which constrains the architecture.

## Decision

### Stack
- **Desktop shell:** Tauri 2 (Rust core). Chosen for small binary (~7-10MB), fast startup
  (~300ms), native feel; proven for this exact category by Terax and opcode.
- **UI:** React + TypeScript in the WebView. State via Zustand (confirmed by both Terax and opcode).
- **Terminal rendering:** xterm.js with the WebGL renderer addon.
- **PTY:** portable-pty (Rust) in the Tauri core.
- **Engine:** a host-agnostic TypeScript library, shipped as a **Bun sidecar** binary that the
  Tauri core spawns and supervises. Keeps orchestration logic in TypeScript and runs the
  Anthropic Claude Agent SDK (TypeScript) natively.
- **Claude Code:** spawned as child processes (interactive `claude` in a PTY for the live
  terminal; structured data read via the Agent SDK).
- **Secrets:** OS keychain (via Tauri / `keyring`).
- **License:** Apache 2.0 (Constitution Principle IV).
- **Target:** macOS + Linux first; Windows later.

### Component shape
```
Tauri app
├─ WebView: React + TS + Zustand + xterm.js  (all UI, terminal panes)
├─ Rust core: window, menus, OS keychain, portable-pty, spawns claude + sidecar
└─ Bun sidecar (TypeScript engine):
   ├─ ClaudeCodeAdapter   ← isolates ALL Claude Code integration (Principle XI)
   ├─ SessionManager      (session trees, per ADR 0002)
   ├─ EventBus / HookRegistry  (lifecycle events + jiti TS extensions)
   ├─ CostTracker, WorktreeIndex
   └─ RemoteServer        (HTTP/WS for web/mobile cockpit)
```

### Mandatory integration rules (from ADR 0003 Principle XI + verified research)
1. **Single `ClaudeCodeAdapter`.** Every read/spawn/fork of Claude Code goes through it. If the
   Claude Code interface changes, exactly one module changes.
2. **Read via SDK APIs** (`listSessions`, `getSessionMessages`), NOT raw `~/.claude/projects`
   JSONL parsing. (Raw parsing was researched and rejected — the SDK read APIs are usable.)
3. **No tight `listSessions()` polling.** Documented memory leak (SDK issue #268) balloons polling
   apps to 1GB+. Use event/debounce, not interval polling, for the sessions sidebar + status bar.
4. **Isolate sessions per worktree directory.** Multiple Claude Code sessions in ONE directory
   trigger the verified cross-session JSONL contamination bug (#26964). One session per worktree dir.
5. **Do not rely on `bun build --compile` for the SDK path.** Compiling the sidecar with the SDK
   bundled breaks CLI resolution (`cli.js not found in /$bunfs/`, SDK issue #150). Mitigation:
   ship the engine as plain Bun (not `--compile`), or set `pathToClaudeCodeExecutable` / extract
   the binary. To be settled in the validation spike.

### Engine is host-agnostic
The Bun engine library has zero Tauri dependency. Desktop = Tauri spawns it; future paid hosted
tier = a server process runs the same library; future CLI/web = same library. This keeps the
Tauri bet reversible and the paid tier a no-rewrite.

## Consequences

- One new language in the repo (Rust, for the Tauri core + PTY) — bounded; most logic stays TS.
- The validation spike MUST answer three verified-risk questions before broad build:
  (a) can the Bun sidecar read an *interactively-created* session via the SDK?
  (b) does fork/resume work on it?
  (c) does the sidecar packaging survive the `bun build --compile` SDK issue, or do we ship
      plain Bun?
- xterm.js WebGL context ceiling (~8-16) caps simultaneous live panes; many-pane layouts need a
  shared-context workaround. Acceptable for V1 (few concurrent panes).
- Tauri WebKitGTK on Linux carries a cosmetic/QA tax (font weight, per-OS testing) — manageable;
  Terax ships Linux fine.

## Alternatives considered
- **Electron** — all-TypeScript, bundled-Chromium render consistency, but ~150MB / slower; Wave
  proves it works. Rejected in favor of Tauri's binary/feel, accepting the Rust + Linux-QA tax.
- **Fork Wave or Terax** — rejected; the product IS the terminal-native UX, so we own the UI from
  line 1 and study (not fork) the Apache-2.0 references.
- **Engine in Rust** — rejected; keeps us out of the TS Agent SDK and slows iteration. Bun sidecar
  keeps the engine in TypeScript.
- **Raw JSONL file-watching for integration** — rejected; verified-fragile, and SDK read APIs exist.

## References
- `docs/research/competitive/viability-2026.md`
- `docs/research/competitive/pi.md`, `warp.md` (if present)
- ADR 0002 (JSONL tree, lifecycle events, jiti extensions, steering primitives)
- ADR 0003 (positioning + Principle XI)
- Reference apps: Terax (`crynta/terax-ai`), Wave Terminal (`wavetermdev/waveterm`), opcode (`winfunc/opcode`)
