<!--
SYNC IMPACT REPORT
==================
Version change: (none) → 1.0.0
Bump rationale: Initial ratification. No prior constitution existed. Baseline MAJOR
                established per the project's own SemVer policy for v1.0+ artifacts.

Added principles:
  I.   Mission
  II.  Scope Boundary (Layer Discipline)
  III. Code Quality Bar (NON-NEGOTIABLE)
  IV.  License (LOCKED)
  V.   OSS / Paid Split — Operations, Not Capability
  VI.  SemVer with v0.x Flexibility
  VII. Weekly Heartbeat, Feature-Driven Versions
  VIII.Contributor Governance
  IX.  AGENTS.md as Memory Standard (NON-NEGOTIABLE)
  X.   Anthropic Relationship — Deprecate-or-Rebase with Layer Test

Renamed principles: (none — initial)
Removed principles: (none — initial)

Added sections:
  - Development Workflow & Quality Gates
  - Release Discipline
  - Governance

Removed sections: (none — initial)

Templates audited:
  ✅ .specify/templates/plan-template.md — Constitution Check section is principle-agnostic
      (generic gate stub); no edits required, principles will be referenced at /speckit.plan time.
  ✅ .specify/templates/spec-template.md — no constitution-coupled language; no edits required.
  ✅ .specify/templates/tasks-template.md — TDD-when-included stance aligns with Principle III's
      conditional TDD rule; no edits required.
  ✅ .claude/commands/speckit.*.md — agent-specific naming is structural (tool-bound by directory);
      no edits required.

Follow-up TODOs: (none deferred)

Source of authority: docs/adr/0001-constitution-principles.md (committed 2026-05-18, c5a2bb1)
-->

# GlaudeCode Constitution

## Core Principles

### I. Mission

GlaudeCode is the Claude Code Companion CLI — a meta-layer above Claude Code that adds
capture+recall, multi-session orchestration, remote cockpit, and session UX. It exists to make
Claude Code dramatically more useful without replacing or competing with it.

**Rationale**: The project's defensibility comes from operating at a layer Claude Code does not
serve. Forgetting this mission leads to direct competition with a vendor whose surface area we
cannot match.

### II. Scope Boundary (Layer Discipline)

GlaudeCode operates at a different layer from Claude Code. Claude Code operates inside one
session. GlaudeCode operates across many sessions, worktrees, and machines. Anything that
belongs inside one Claude Code session MUST be either upstreamed to Anthropic or deferred from
the GlaudeCode roadmap.

**Rationale**: Layer discipline is the single test every feature must pass to remain in scope.
Without it, scope creep turns this project into a fork of Claude Code.

### III. Code Quality Bar (NON-NEGOTIABLE)

- TDD is REQUIRED where rework cost exceeds planning cost. The judgment call is documented in
  the feature's spec or plan; absence of justification defaults to TDD-on.
- `verification-before-completion` is mandatory. No completion claim may be made without an
  attached evidence artifact (test output, screenshot, command transcript, or equivalent).
- Every pull request MUST pass `pr-review-toolkit` (Silent Failure Hunter, PR Test Analyzer,
  Comment Analyzer, Type Design Analyzer) before merge. Failures block merge; they are not
  waivable for v0.x or v1.0+.
- The `security-guidance` plugin hook is a stop-the-line signal. When it fires, work pauses
  until the flagged pattern is resolved or explicitly justified in writing.

**Rationale**: A solo OSS project survives on trust. Trust comes from observable discipline:
tests that exist, evidence that work was verified, and reviewers that cannot be bypassed.

### IV. License (LOCKED)

The project is released under Apache License 2.0, including its patent grant. This license is
non-negotiable and not re-debatable in any future amendment. Any proposed re-licensing is out of
scope for this constitution.

**Rationale**: Apache 2.0 was selected after deliberation against MIT and AGPL. The patent grant
is load-bearing for downstream adoption in enterprise contexts; weaker permissive licenses
forfeit it without offsetting benefit.

### V. OSS / Paid Split — Operations, Not Capability

- The OSS tier ships all 4 primitives and all 9 V1 features. The orchestrator runs locally on
  the user's machine; remote clients (phone, browser) connect to that local orchestrator over a
  transport the user provides (LAN, Tailscale, SSH tunnel, etc.).
- The paid hosted tier ships the same primitives with a managed orchestrator, multi-device
  sync, team operations, audit, and support.
- **We sell operations, not capability.** No primitive is paywalled.

**Rationale**: Paywalling a primitive contradicts the OSS-core positioning and fragments the
product story. Selling operations preserves OSS gravity while creating a paid tier with real
COGS to justify the price.

### VI. SemVer with v0.x Flexibility

- The project follows Semantic Versioning.
- v0.x permits breaking changes without ceremony.
- v1.0+ enforces a stable contract with documented deprecation windows.
- The versioned public surface is: CLI commands, configuration schema, hook signatures, and
  the AGENTS.md format. Internals are free to evolve and are not part of the contract.

**Rationale**: A precise public surface is necessary for users and integrators to depend on the
project. Internals must remain free to refactor or the project will calcify.

### VII. Weekly Heartbeat, Feature-Driven Versions

- Every Friday the project publishes something: a version tag, a demo, or a dev log. This is the
  heartbeat.
- Version bumps follow features landing, not the calendar. A heartbeat with no version bump is
  expected and acceptable.
- A missed Friday is a real signal to course-correct. It MUST be acknowledged in the next
  heartbeat post; it MUST NOT be silently skipped.

**Rationale**: A solo founder needs an external forcing function to escape research-loop
failure modes. Decoupling publishing rhythm from version bumps avoids the trap of shipping
trivial work to satisfy a calendar.

### VIII. Contributor Governance

- The solo founder holds final authority on all decisions until the first external contributor
  lands meaningful work.
- No Contributor License Agreement is required for v0.x.
- Architectural decisions land as numbered ADRs in `docs/adr/`. The constitution is the highest
  authority; ADRs interpret and extend it but cannot contradict it.
- Governance graduates to a lightweight maintainer model only when external contributors are
  present. Until then, formal governance overhead is rejected as premature.

**Rationale**: Governance overhead before contributors arrive consumes founder time without
producing value. Light governance is the honest answer for v0.x.

### IX. AGENTS.md as Memory Standard (NON-NEGOTIABLE)

- `AGENTS.md` is the cross-tool agent memory file for this repository. It is read natively by
  Codex CLI, Cursor, Windsurf, and GitHub Copilot.
- `CLAUDE.md` is a symbolic link to `AGENTS.md`. The link MUST NOT be replaced with a divergent
  copy.
- Every feature specification MUST include a planned `AGENTS.md` diff as part of its definition
  of done. Specifications that do not update `AGENTS.md` are incomplete and MUST be rejected at
  review.
- Keeping `AGENTS.md` current is load-bearing for the product, not a documentation nicety.

**Rationale**: The product's value proposition rests on cross-session, cross-tool agent memory.
A stale `AGENTS.md` in our own repository would invalidate every claim the project makes.

### X. Anthropic Relationship — Deprecate-or-Rebase with Layer Test

- When Anthropic ships a feature that appears to overlap with one of ours, GlaudeCode publishes
  a Differentiation Note within 30 calendar days.
- **Overlap is judged by layer, not theme.** Anthropic shipping mobile control of one Claude
  Code session is not overlap with our multi-session cockpit. The Differentiation Note MUST
  explicitly state which layer Anthropic's feature operates on and which layer ours operates on.
- **Same-layer overlap → deprecate-or-rebase**: announce sunset for one minor version and then
  remove our feature, or rebuild our feature on top of Anthropic's. We do not run parallel
  implementations at the same layer.
- **Different-layer overlap → keep and sharpen**: retain our feature and update documentation to
  make the layer distinction explicit and unambiguous.
- We work with Anthropic, never against.

**Rationale**: The meta-layer positioning is the project's defensible wedge. Defending it
honestly requires a public, structured response to Anthropic's roadmap rather than reflexive
deprecation or reflexive defiance.

## Development Workflow & Quality Gates

- **Spec-Kit flow is the path to merge.** Features progress through `/speckit.constitution` →
  `/speckit.specify` → `/speckit.clarify` → `/speckit.plan` → `/speckit.tasks` →
  `/speckit.taskstoissues` → `/speckit.implement`. Skipping clarify or plan stages for non-trivial
  work is a constitution violation.
- **Brainstorming is required before creative work.** The Superpowers `brainstorming` skill MUST
  be invoked before drafting any new feature spec.
- **Worktrees for feature isolation.** Feature work runs in a git worktree (Superpowers
  `using-git-worktrees`) unless the change is single-commit and clearly isolated.
- **PR gate stack**: `feature-dev` → `code-review` → `pr-review-toolkit` → `/commit-push-pr`.
  Each gate runs to completion; partial passes are not acceptable.
- **Complexity must be justified.** Any deviation from these gates is recorded in the feature's
  plan under a Complexity Tracking section per the plan template.

## Release Discipline

- **Versioning**: SemVer per Principle VI. The public surface is the contract.
- **Heartbeat**: Friday publishing per Principle VII. Heartbeat posts include either a release
  link, a demo asset, or a dev-log entry.
- **Changelogs**: Every version tag includes a release note covering user-facing changes,
  breaking changes (in v0.x, allowed; in v1.0+, requires deprecation window), and migration
  notes when applicable.
- **First heartbeat**: 2026-05-22.

## Governance

- This constitution supersedes all other project practices, conventions, and informal rules.
  When conflicts exist, the constitution wins.
- **Amendment procedure**: a proposed amendment is documented as a new ADR in `docs/adr/`. The
  amendment ADR cites which principle(s) it modifies, justifies the change, and proposes the
  resulting constitution version bump per Principle VI rules:
  - MAJOR: removing a principle or redefining one in a backward-incompatible way.
  - MINOR: adding a principle or materially expanding guidance.
  - PATCH: clarifications, typo fixes, non-semantic refinements.
- **Approval**: while solo (per Principle VIII), the founder approves and merges amendments.
  Post-graduation, lightweight maintainer review applies.
- **Compliance review**: every pull request description MUST include either a statement that no
  principle is affected, or a list of affected principles with justification. PRs that affect
  principles without justification are rejected.
- **Constitutional override clause**: when the user's explicit instructions in `AGENTS.md`,
  `CLAUDE.md`, or in-session directives conflict with skill or plugin defaults, the user's
  instructions win. This constitution is bound by the same hierarchy when interpreted by agents.
- **Source-of-truth pointer**: the most current authority for principle rationale and history is
  the ADR series in `docs/adr/`, anchored by ADR 0001.

**Version**: 1.0.0 | **Ratified**: 2026-05-18 | **Last Amended**: 2026-05-18
