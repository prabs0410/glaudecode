# ADR 0002 — Adopt Pi-Inspired Design Conventions

**Status:** Accepted
**Date:** 2026-05-18
**Decision owner:** Prabhakaran R (solo founder)
**Supersedes / amends:** none

## Context

Pi (`@earendil-works/pi-coding-agent`) is a terminal coding harness whose design solves
several problems GlaudeCode will face in V1 implementation. Researching Pi (full notes in
`docs/research/competitive/pi.md`) surfaced five conventions worth adopting verbatim or with
minor adaptation. Locking adoption now prevents future feature specs from independently
re-deriving (or worse, diverging from) these conventions.

This ADR is taken under Principle X (Anthropic relationship). Pi is not Anthropic, but the
same intellectual discipline applies: do not duplicate work that someone else has already
done well; differentiate where layer differs; integrate where it does not.

## Decision

GlaudeCode adopts the following five conventions. Each is normative for any V1 feature spec
that touches the relevant area.

### 1. Session lifecycle event taxonomy

GlaudeCode will use Pi's lifecycle event names verbatim for in-process events, and extend
with cross-machine events at GlaudeCode's own layer.

**Pi-compatible events (in-process, single session):**

| Event | Notes |
|---|---|
| `session_start` | Carries `reason: "startup" \| "new" \| "resume" \| "fork"` |
| `session_before_switch` | Fired before a session switch (resume/new) |
| `session_before_fork` | Fired before fork; receives source position |
| `session_before_compact` | Fired before context compaction |
| `session_compact` | Fired after compaction |
| `session_shutdown` | Fired before teardown |

**GlaudeCode-additional events (cross-session / cross-machine, GC's wedge):**

| Event | Layer |
|---|---|
| `session_forked_to_worktree` | Orchestrator-level; emitted when a fork spans a worktree boundary |
| `session_merged_from_peer` | Orchestrator-level; emitted when a co-agent session merges back |
| `session_mobile_approved` | Cockpit-level; emitted when a mobile/web client approves a pending action |
| `session_orchestrator_attached` | Process-lifecycle; emitted when the GC orchestrator attaches to a host harness instance |
| `session_orchestrator_detached` | Process-lifecycle; complement of the above |

**Rationale:** Pi has already solved the in-process taxonomy. Adopting their names buys
cross-tool hook portability (a hook written against the Pi-compatible subset works in both
worlds) at zero design cost. GC's additional events live at a strictly higher layer and
therefore do not conflict with Principle X's layer test.

### 2. JSONL tree session storage

GlaudeCode session storage uses Pi's JSONL tree format. Each entry has `id` and `parentId`;
the current position is the active leaf. The schema extends Pi's with optional
GC-specific fields for cross-session linkage.

**Required fields (Pi-compatible):**

- `id` (string)
- `parentId` (string | null)
- `type` (string — message, model_change, label, compaction, branch_summary, extension)
- `timestamp` (ISO 8601)
- `payload` (object — type-specific)

**GC-additional optional fields:**

- `peerSessionId` (string — links to a sibling session in the same orchestration)
- `originOrchestratorId` (string — identifies the GC orchestrator that created the entry)
- `mobileApprovalRef` (string — links to a cockpit approval event, when applicable)

**Compatibility goal:** sessions written by GlaudeCode SHOULD be readable by Pi as long as
Pi tolerates unknown fields (verify before V1 release). This is a soft goal, not a hard
contract — diverging from this for a strong reason is allowed if recorded in a subsequent
ADR.

**Rationale:** Native branching in storage is the right design. Pi has already shipped it
and it overlaps cleanly with feature #5 (fork from same context) and feature #6 (continue
left-out session — addressable by tree position, not just UUID).

### 3. Fork verb decomposition

The user-facing command surface MUST distinguish these operations:

| Command | Semantics |
|---|---|
| `fork` | New session file branching from an earlier prompt |
| `tree` | Navigate alternative branches in the current session (no new file) |
| `clone` | Duplicate the active branch into a new session |
| `co-fork` | GC-additional: fork the entire orchestration state — multiple sessions branch as a coordinated unit |

**Rationale:** Conflating these under "fork" obscures meaningful distinctions. Pi has
already done the verb decomposition for in-session granularity; GC adds the orchestration
verb at its own layer.

### 4. Steering primitives

Any GlaudeCode orchestrator API that exposes external control of a running session MUST
provide these two verbs:

- `steer(message)` — interrupt the current generation with new direction.
- `followUp(message)` — queue a message to be sent after the current generation completes.

These are the primitives the remote cockpit features (#3 mobile, #4 web) build on.

**Rationale:** Pi's SDK has already validated this pair. A phone client needs both verbs:
"interrupt" and "queue." Adopting the names buys consistency for any developer who has
worked with either tool.

### 5. Zero-compile TypeScript extensions via `jiti`

If GlaudeCode ships an extension model in V1 (it likely will, for cross-session lifecycle
hooks per feature #9), extensions MUST load via `jiti`. No `tsc`, no Vite, no build step.
Contributors edit a `.ts` file and reload.

**Rationale:** Lowest contributor friction. Same model Pi has already proved out. Avoids
inheriting a build-tool dependency in a project whose extension model should remain
intentionally minimal.

## Consequences

- **Feature #5** (fork from same context) inherits conventions 2 and 3.
- **Feature #6** (continue left-out session) inherits convention 2 — sessions become
  addressable by tree position, not just UUID, which fixes the original "blank sessions
  picker" pain.
- **Feature #9** (CLI-level lifecycle hooks) inherits convention 1. The taxonomy is now
  locked; the implementation question becomes "where do these events fire from" rather
  than "what events should we emit."
- **Features #3 and #4** (mobile, web cockpit) inherit convention 4.
- Any extension-shipping feature inherits convention 5.
- **Compatibility implication:** GlaudeCode commits to a soft Pi-readability goal for its
  session files. Diverging requires a follow-up ADR.

## Alternatives considered

- **Invent our own taxonomy and storage format** — rejected; Pi has already done the work,
  and adopting their names buys hook portability with no offsetting downside.
- **Adopt the ideas but rename everything** — rejected; the names are the interop, and
  renaming gains nothing.
- **Defer adoption until each feature spec** — rejected; conventions 1 and 2 overlap
  (lifecycle events are stored as JSONL entries), so locking them together prevents
  inconsistency across feature specs.
- **Adopt Pi's multi-provider model too** — rejected; GlaudeCode orchestrates host
  harnesses, it is not itself an agent. Multi-provider is out of scope.

## References

- `docs/research/competitive/pi.md` — full Pi research, overlap matrix, strategic implications.
- `docs/adr/0001-constitution-principles.md` — Principle X (Anthropic relationship, layer test).
- `.specify/memory/constitution.md` v1.0.0 — formal constitution.
- Pi documentation: https://pi.dev/docs/latest
- Agent Skills standard: https://agentskills.io/specification
