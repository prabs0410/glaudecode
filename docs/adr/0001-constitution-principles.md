# ADR 0001 — Constitution Principles for GlaudeCode

**Status:** Accepted
**Date:** 2026-05-18
**Decision owner:** Prabhakaran R (solo founder)

## Context

GlaudeCode is a meta-layer CLI above Claude Code, bootstrapped on 2026-05-14 with Spec-Kit, Superpowers, and Anthropic-official plugins. Before any feature spec is written, the project needs a constitution that locks the non-negotiables that every spec, PR, and release must honor. This ADR captures the 10 principles agreed upon during the brainstorming session on 2026-05-18 and serves as the authoritative input for `/speckit.constitution`, which will produce `.specify/memory/constitution.md`.

## Decision

The following 10 principles are locked. Each governs one axis of the project. `/speckit.constitution` shall render them into the formal constitution document without dilution.

### 1. Mission
GlaudeCode is the Claude Code Companion CLI — a meta-layer above Claude Code that adds capture+recall, multi-session orchestration, remote cockpit, and session UX. It exists to make Claude Code dramatically more useful without replacing or competing with it.

### 2. Scope boundary
GlaudeCode operates at a different layer from Claude Code. Claude Code operates inside one session. GlaudeCode operates across many sessions, worktrees, and machines. Anything that belongs inside one Claude Code session is out of scope and should be upstreamed to Anthropic or deferred.

### 3. Code quality bar
- TDD where rework cost exceeds planning cost (per Superpowers `test-driven-development`).
- `verification-before-completion` is mandatory — evidence before claims, no exceptions.
- All PRs pass `pr-review-toolkit` (Silent Failure Hunter, Test Analyzer, Comment Analyzer, Type Design Analyzer) before merge.
- The `security-guidance` plugin hook is treated as a stop-the-line signal.

### 4. License (locked)
Apache 2.0, with the patent grant intact. Non-negotiable. Not re-debatable in any future ADR.

### 5. OSS / paid split — local vs cross-machine, with feature parity
- OSS tier: all 4 primitives, all 9 V1 features. The orchestrator runs locally on the user's machine; remote clients (phone, browser) connect to that local orchestrator over a transport the user provides (LAN, Tailscale, SSH tunnel, etc.).
- Paid hosted tier: the same primitives, with a managed orchestrator, multi-device sync, team operations, audit, and support.
- We sell operations, not capability. No primitive is paywalled.

### 6. Versioning — SemVer with v0.x flexibility
- v0.x allows breaking changes without ceremony.
- v1.0+ enforces a stable contract with documented deprecation windows.
- The versioned public surface is: CLI commands, config schema, hook signatures, and AGENTS.md format. Internals are free to evolve.

### 7. Release cadence — weekly heartbeat, feature-driven versions
- Every Friday, publish something: a version tag, a demo, or a dev log.
- Version bumps follow features, not the calendar.
- A missed Friday is a real signal to course-correct, not a failure to bury.

### 8. Contributor governance
- Solo-founder ownership until the first external contributor lands meaningful work.
- No CLA for v0.x.
- Architectural decisions land as ADRs in `docs/adr/`.
- Governance graduates to a lightweight maintainer model only when external contributors are present — not before.

### 9. AGENTS.md as the memory standard
- `AGENTS.md` is the cross-tool agent memory file (read natively by Codex CLI, Cursor, Windsurf, and GitHub Copilot).
- `CLAUDE.md` is a symlink to `AGENTS.md`.
- Every feature spec MUST update `AGENTS.md` as part of its definition of done.
- Keeping `AGENTS.md` current is treated as load-bearing, not optional.

### 10. Anthropic relationship — deprecate-or-rebase with a layer test
- When Anthropic ships a feature that appears to overlap with one of ours, we publish a Differentiation Note within 30 days.
- Overlap is judged by layer, not theme. Anthropic shipping mobile control of one Claude Code session is not overlap with our multi-session cockpit.
- Same-layer overlap → deprecate-or-rebase: announce sunset for one minor version, then remove; or rebuild our feature on top of theirs.
- Different-layer overlap → keep our feature and sharpen the docs to make the layer distinction explicit.
- We work with Anthropic, never against.

## Consequences

- Every future feature spec must pass the scope-boundary test (Principle 2) and the layer test (Principle 10) before clarification.
- The paid hosted tier (Principle 5) must be designed alongside V1 OSS work, not deferred.
- The Friday heartbeat (Principle 7) is a forcing function — the first heartbeat is due 2026-05-22.
- Every PR description and feature spec must show the `AGENTS.md` diff (Principle 9). Specs without it are not done.

## Alternatives considered

- **Pure feature-driven release cadence** — rejected; no external accountability, reproduces the prior research-loop failure mode.
- **Single-session-OSS / orchestration-paid split** — rejected; paywalls the defensible wedge and weakens the OSS story.
- **All features free, scale-only paid** — rejected; incompatible with the founder's near-term revenue goal.
- **Deprecate-on-any-overlap (no layer test)** — rejected; would force premature deprecation of features that are thematic-but-different from Anthropic's.

## References

- `README.md` — public-facing pitch.
- `AGENTS.md` — cross-tool agent memory and project conventions.
- Handoff document (2026-05-18) — locked decisions and per-feature roadmap.
- `.specify/templates/constitution-template.md` — template for the rendered constitution.
