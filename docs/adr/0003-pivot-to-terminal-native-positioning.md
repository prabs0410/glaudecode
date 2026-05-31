# ADR 0003 — Pivot Positioning from "Meta-Layer" to "The Terminal That Makes Claude Code Exceptional"

**Status:** Accepted
**Date:** 2026-06-01
**Decision owner:** Prabhakaran R (solo founder)
**Amends:** ADR 0001 (Constitution Principles I, II, X); adds Principle XI
**Constitution version:** 1.0.0 → 2.0.0 (MAJOR — backward-incompatible redefinition of Principles I, II, X)

## Context

ADR 0001 framed GlaudeCode as a "meta-layer above Claude Code" — a neutral orchestrator
operating at a *different layer* (across sessions/worktrees/machines) from Claude Code (inside
one session). Two months of research and discussion (2026-05-14 → 2026-06-01) invalidated that
framing on both product and strategic grounds:

1. **The "meta-layer" framing optimized for scope-feasibility, not user value.** The founder's
   own instinct — confirmed in session — is that integration *depth* (the Cursor-to-VS-Code
   relationship) attracts users, while a neutral layer-above does not. Recorded in memory
   `feedback-depth-of-integration-beats-layer-above`.

2. **The competitive landscape closed the "different layer" gap.** Deep research
   (`docs/research/competitive/viability-2026.md`, 108-agent verified pass, 2026-06-01):
   - Anthropic's April 2026 Claude Code desktop redesign already ships sessions sidebar,
     parallel worktree-isolated sessions, diff viewer, integrated terminal — most of the planned
     "meta-layer" surface, from the CLI owner.
   - opcode/Claudia (~22k stars, YC-backed, identical Tauri+React+Rust+Bun stack) ships session
     resume, custom agents, checkpoints/branching, cost tracking, MCP management — free.
   - The neutral-orchestrator position is occupied; the *terminal-native, Claude-Code-tuned*
     position is the remaining defensible (if narrow) opening.

3. **The integration substrate is verified-unstable** — cross-session JSONL contamination
   (up to 76.6%), auto-update session deletion (520/520), SDK churn, `bun build --compile`
   breaking the SDK. This is a first-class risk the constitution must name.

The founder reviewed this evidence and chose to **proceed and build** (recorded in memory
`project-proceed-decision-crowded-space`), with the goal restated as: *"make Claude Code more
powerful, versatile, and useful with our terminal."* Strategy is both/and — build the sharp
terminal-native core AND the planned features AND keep researching the unserved wedge — with an
explicit pivot thesis: ship to learn which niche sells, then re-market the CLI around it.

## Decision

Amend the constitution as follows.

### Principle I — Mission (redefined)
GlaudeCode is **the terminal built to make Claude Code exceptional.** It is a desktop terminal
emulator, deeply integrated with Claude Code, that makes everyday Claude Code work more powerful,
visible, and controllable. It exists to make Claude Code users dramatically more effective — not
to replace Claude Code, and not to abstract it away behind a neutral layer.

### Principle II — Scope Boundary (redefined: integration depth, not layer separation)
GlaudeCode competes on **integration depth, not layer separation** (the Cursor-to-VS-Code
relationship, not a meta-layer above). Every feature must answer: *"does this make a Claude Code
user's work meaningfully better than their current terminal does?"* Features that merely re-skin
what Claude Code, opcode, or Anthropic's own app already do well are out of scope; the bar is a
felt improvement to the Claude Code experience, especially where incumbents are weak
(terminal-native UX, Linux-first, OSS hackability).

### Principle X — Anthropic Relationship (redefined: encroachment is expected)
Anthropic owns Claude Code and ships a competing first-party app; **encroachment is expected, not
exceptional.** GlaudeCode works *with* Claude Code as a dependency and amplifier. When Anthropic
ships something that overlaps a GlaudeCode feature, we do not reflexively deprecate — we ask
whether our version still serves a Claude Code user better for a real reason (terminal-native,
cross-platform, hackable, faster-moving). If yes, keep and sharpen; if no, drop it. We never
depend on Claude Code internals we cannot isolate behind an adapter.

### Principle XI — Foundation Risk (new)
GlaudeCode is built on Claude Code's session interface, which is verified-unstable (cross-session
JSONL contamination, auto-update data loss, SDK churn). All such integration MUST be isolated
behind a single `ClaudeCodeAdapter`, read via supported SDK APIs (`listSessions`,
`getSessionMessages`) rather than raw JSONL parsing, avoid tight polling loops (documented
`listSessions()` memory leak), and remain resilient to the interface changing without notice.

## Consequences

- The "layer test" from old Principle II is replaced by the "felt-improvement test." Feature
  specs must justify against incumbents, not against a layer boundary.
- Old Principle X's 30-day Differentiation Note ritual is removed; encroachment is normal and
  handled case-by-case via the keep-and-sharpen-or-drop rule.
- The 9 planned features are re-evaluated against the felt-improvement bar in a later session;
  commoditized ones (basic sessions sidebar, basic fork) are not differentiators on their own.
- Principle XI binds the architecture (see ADR 0004): the `ClaudeCodeAdapter` is mandatory.
- README, AGENTS.md, docs/state.md, and the constitution are updated in the same change to remove
  all "meta-layer" framing.
- Constitution version → 2.0.0.

## Alternatives considered

- **Narrow to a single feature** (drop the broad set) — rejected by founder; both/and chosen,
  with the felt-improvement bar as the filter instead of an up-front cut.
- **Keep the meta-layer framing** — rejected; invalidated by competition and by the
  depth-over-layer lesson.
- **Stop / pivot away from the idea entirely** — rejected; founder chose to build to learn, with
  an explicit later-pivot path to a validated niche.

## References

- `docs/research/competitive/viability-2026.md` — verified competitive + integration research
- `docs/adr/0001-constitution-principles.md` — the principles being amended
- `docs/adr/0002-adopt-pi-design-conventions.md` — data-model conventions (still in force)
- `docs/adr/0004-system-architecture.md` — the architecture this positioning implies
- Memory: `feedback-depth-of-integration-beats-layer-above`, `project-proceed-decision-crowded-space`
