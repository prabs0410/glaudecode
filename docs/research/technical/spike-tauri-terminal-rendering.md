# Spike — Tauri Terminal Rendering (Claude Code in our terminal)

**Date**: 2026-06-01
**Researcher**: GlaudeCode session
**Question**: Does the ADR 0004 terminal stack actually work — Tauri 2 + React + xterm.js (WebGL) + portable-pty running a real shell, with Claude Code's TUI rendering correctly inside it?
**Environment**: bun 1.2.18, cargo 1.88.0, Tauri 2.11.2, xterm.js 6.0.0, portable-pty 0.9.0, macOS (WKWebView)
**Location**: `packages/desktop/` (the real, keepable skeleton — NOT throwaway)

## Result — VERIFIED ✅ (visual evidence captured)

Built and launched `packages/desktop` (`bun run tauri dev`). A native Tauri window opened with
an xterm.js terminal bound to a real PTY running the user's login shell in the repo directory.

Confirmed by screenshot:
- **PTY + shell**: zsh spawned and ran (`ls` executed, output rendered correctly).
- **xterm.js rendering**: clean — colors, layout, cursor, box drawing all correct.
- **Claude Code TUI inside our terminal**: `claude` launched and its full interface rendered
  perfectly — the pixel-art logo, "Claude Code v2.1.167 / Opus 4.8", the `/loop` highlight, the
  yellow `⚠ 4 setup issues` line, the input box, and the `0 tokens · high · /effort` status bar.
  No garbling, ANSI intact.
- **Input**: typing and control keys (Ctrl-C) flowed through to the PTY correctly.

## What this proves
ADR 0004's terminal stack is no longer a bet — it runs. Combined with the SDK spike
(`spike-claude-code-integration.md`), BOTH halves of the architecture are now verified with real
evidence: Claude Code's data (read/fork via SDK) AND Claude Code's rendering (Tauri + xterm.js +
portable-pty). The project has a working, validated foundation.

## Build facts (for reference)
- First `cargo check`: ~59s. First full `tauri dev` bin build: ~39s. (Subsequent builds far faster.)
- Compiled clean — no errors, no warnings of note.
- `core:default` capability covers app-command invokes + event listen; no extra ACL needed.

## Implementation notes (what the skeleton contains)
- **Rust** (`src-tauri/src/lib.rs`): `pty_spawn`/`pty_write`/`pty_resize` commands. Reader thread
  emits raw output **bytes** via `pty-output`; frontend decodes with a streaming `TextDecoder`
  (multibyte UTF-8 split across reads is safe). PTY writer + master held in Tauri managed state.
- **Frontend** (`src/App.tsx`): xterm.js + FitAddon + WebglAddon (canvas fallback if WebGL fails).
  `startedRef` guard prevents double-spawn; `StrictMode` removed in `main.tsx` for the same reason.

## NOT tested by this spike (honest scope)
- Linux WebKitGTK rendering (only macOS WKWebView tested). Manageable tax per research; verify later.
- Many simultaneous panes vs the xterm.js WebGL context ceiling (~8-16). Single pane only here.
- The `query()`-under-`--compile` path (#150) — separate from rendering; noted in the SDK spike.

## Next
The skeleton is the foundation to build on (sessions sidebar, agent-state bar, etc. via the
ClaudeCodeAdapter + the SDK read APIs proven in the other spike). Cosmetic: window title is still
"desktop" (tauri.conf.json `productName`) — rename to GlaudeCode when polishing.
