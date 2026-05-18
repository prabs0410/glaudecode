# Pi — Competitive Research

**Date**: 2026-05-18
**Source**: https://pi.dev/docs/latest (and subpages: sessions, sdk, extensions, skills, providers)
**Maintainer**: `@earendil-works` (npm scope), org details not yet verified
**Researcher**: GlaudeCode session log, 2026-05-18

## TL;DR

Pi is a direct alternative to Claude Code, not a meta-layer above it. It is strong in areas
GlaudeCode does not plan to compete (multi-provider, in-session branching, polished
extensions) and weak in the exact areas GlaudeCode's wedge lives (multi-session orchestration,
cross-session memory, network-transport remote cockpit). Threat level is real but bounded.
Two GlaudeCode feature framings need adjustment; the core wedge survives intact.

## What Pi is

A "minimal terminal coding harness," installable via `curl` or
`@earendil-works/pi-coding-agent` on npm. Embeddable as a Node.js SDK. Multi-provider
(30+ providers including Anthropic, OpenAI, Gemini, DeepSeek, plus subscription routes
through Claude Pro/Max, ChatGPT Plus/Pro, and GitHub Copilot). TypeScript-based extension
model. Skills follow the agentskills.io standard.

## Feature inventory

### Session model
- Storage: JSONL files in `~/.pi/agent/sessions/`, organized by working directory.
- Each entry carries `id` and `parentId`; the session is literally a DAG.
- Branching verbs: `/fork` (new file from earlier prompt), `/tree` (navigate alt branches in
  the same file), `/clone` (duplicate active branch).
- Scope: single CLI process. No IPC, no inter-session communication documented.
- Memory: per-session only. No cross-session memory layer.

### Extension model
- Loaded from `~/.pi/agent/extensions/*.ts` or `.pi/extensions/*.ts`, via `jiti` (no compile).
- Registers tools (`pi.registerTool`), commands (`pi.registerCommand`), event handlers
  (`pi.on`), UI components, message renderers, custom providers.
- Lifecycle events: `session_start` (with `reason: "startup" | "new" | "resume" | "fork"`),
  `session_before_switch`, `session_before_fork`, `session_before_compact`,
  `session_compact`, `session_shutdown`.
- Distribution: local files, npm packages, git packages.

### Skills
- Implements the Agent Skills standard (agentskills.io). Self-contained directories with
  `SKILL.md` + scripts + reference docs.
- Progressive disclosure: name + description in context by default; full `SKILL.md` loaded
  on-demand or via `/skill:name`.
- No centralized registry; ships with pointers to Anthropic Skills and Pi Skills repos.

### SDK / control surface
- Embeddable Node SDK via `createAgentSession()`.
- Subprocess RPC mode (`pi --mode rpc --no-session`) using JSON-RPC over stdio.
- Event stream is one-way (agent → subscriber); steering happens via `session.steer()` and
  `session.followUp()` for bidirectional control during streaming.
- Explicitly local-only. No HTTP, WebSocket, Unix socket, or named pipe documented.
- Authentication is credential management (`auth.json`, env vars, `setRuntimeApiKey`,
  `AuthStorage`) — no authorization model for controlling agent instances remotely.

### Providers
- 30+ providers across subscription (Claude Pro/Max, ChatGPT Plus/Pro, GitHub Copilot),
  API-key (Anthropic, OpenAI, Gemini, DeepSeek, Groq, Cerebras, xAI, OpenRouter, etc.), and
  cloud platforms (Bedrock, Vertex, Cloudflare).
- Provider selection appears session-wide via CLI flags; per-task routing not documented.

## Overlap matrix vs GlaudeCode

| GC primitive / feature | Pi today | Verdict |
|---|---|---|
| Capture + recall (#1, #7) | Per-session JSONL only; no cross-session memory | Wedge intact |
| Multi-session orchestration (primitive) | Single-process, no IPC | Wedge fully intact |
| #2 inter-session comm + worktrees | Not present | Open territory |
| #5 fork from same context | `/fork`, `/tree`, `/clone` at single-session granularity | Reframe needed; GC operates across sessions |
| #8 meta-agent across sessions | Not present | Open territory |
| #9 CLI-level lifecycle hooks | Already shipped (full taxonomy) | Reframe needed; GC operates one layer up |
| Remote cockpit (#3, #4) | Local stdio SDK/RPC only; no network transport | Wedge intact |
| #6 continue left-out session | Tree nav + labels solve part of it | Partial overlap |

## What's worth adopting

Captured separately in `docs/adr/0002-adopt-pi-design-conventions.md`. Summary:

1. Session lifecycle event taxonomy (Pi names + GC-additional cross-machine events).
2. JSONL tree session storage (`id` + `parentId` per entry).
3. Fork verb decomposition (`fork` vs `tree` vs `clone`).
4. Steering primitives (`steer`, `followUp`).
5. `jiti` for zero-compile TypeScript extensions.

## What to NOT do

- Don't out-feature Pi on extensions, providers, or in-session UX. That's their game.
- Don't add multi-provider support to GlaudeCode V1 — GC is an orchestrator, not an agent.
- Don't deprecate features #5 or #9 under Principle X's same-layer rule. Pi is
  same-vendor-tier different-layer; the layer test holds.

## Strategic implications

### Reframes locked
- Feature #9: GC's hooks live at cross-process / cross-machine layer. Pi owns in-process.
- Feature #5: GC forks orchestration state across sessions, not history within one session.

### Opportunity surfaced
Pi has a clean SDK and event model. GlaudeCode could plug into Pi the same way it plugs
into Claude Code. Designing the orchestrator abstraction to support multiple host harnesses
from V1 (Claude Code today, Pi tomorrow, Codex CLI later) broadens GC's market and reduces
single-vendor risk. Not a V1 commitment — but the abstraction should not preclude it.

### Positioning note
"Above any AGENTS.md-aware terminal coding harness" is a more durable framing than "above
Claude Code." Doesn't change V1 scope; worth noting for the README's long-tail story.

## Honest uncertainties

- `earendil-works` headcount, funding, and release velocity — unverified.
- Pi installed user count and GitHub momentum — unverified.
- agentskills.io adoption breadth — unverified.
- Whether Pi has multi-session orchestration on roadmap — unverified.
- Pi's business model / monetization — not documented in public docs.

Resolving these would sharpen the threat assessment but does not change the design
inspirations adopted in ADR 0002.

## Suggested follow-up

1. Inspect `earendil-works` org on GitHub (release cadence, contributor count, funding signals).
2. Read the agentskills.io spec — does it conflict with or complement AGENTS.md?
3. Search Pi's issue tracker for "multi-session," "daemon," "remote," "mobile."
4. 30-minute hands-on with Pi to verify resume/recovery UX vs Claude Code.
