# GlaudeCode

> The terminal built to make Claude Code exceptional.

A desktop terminal, deeply integrated with Claude Code, that makes everyday Claude Code work more powerful, visible, and controllable — not a replacement for Claude Code, and not a neutral layer above it.

## Status

🚧 **Pre-implementation.** Bootstrapped 2026-05-14. Constitution v2.0.0 ratified; positioning and architecture locked (see [`docs/adr/`](docs/adr/)). Foundation validation spike is the next step.

## Why

If you use Claude Code daily, the terminal you run it in does nothing to help. GlaudeCode does:

- **See what the agent is actually doing** — live agent state, tool-call timeline, cost as it accrues.
- **Run Claude Code across several worktrees** without copy-pasting between windows.
- **Keep and revisit your work** — sessions you can find, name, search, and continue.
- **Control a running session from your phone or browser** when you step away.
- **Make it yours** — terminal-native, Linux-first, open source, hackable.

The bar for every feature: it has to make a Claude Code user's work meaningfully better than their current terminal does.

## How it's built

Tauri 2 + React/TypeScript + xterm.js, with a TypeScript engine (Bun) that talks to Claude Code through the Agent SDK. All Claude Code integration is isolated behind a single adapter. See [`docs/adr/0004-system-architecture.md`](docs/adr/0004-system-architecture.md).

## License

[Apache License 2.0](LICENSE) — see [`NOTICE`](NOTICE) for attributions.

You can use, modify, and distribute GlaudeCode freely, including in commercial products. Apache 2.0 includes an explicit patent grant from contributors.
