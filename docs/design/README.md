# docs/design/ — V2 Epic Design Docs

Research-backed design documents for the V2 scope (see `docs/GOAL.md`). Unlike V1 — which was a
velocity build (acceptance criteria + tests, thin design) — **no V2 feature gets a goal or a line
of code until its epic design doc is written and reviewed.** This is the discipline the constitution
prescribes (brainstorm → specify → plan → tasks → TDD), applied properly.

## Status
All seven docs are drafted as a batch for founder review before any implementation.

| Epic | Doc | Status |
|---|---|---|
| A — Orchestration | `epic-a-orchestration.md` | draft |
| B — Extensibility | `epic-b-extensibility.md` | draft |
| C — Cost & control | `epic-c-cost-control.md` | draft |
| D — Memory & knowledge | `epic-d-memory-knowledge.md` | draft |
| E — Session tooling | `epic-e-session-tooling.md` | draft |
| F — Terminal UX | `epic-f-terminal-ux.md` | draft |
| G — Cockpit | `epic-g-cockpit.md` | draft |

## Every design doc covers
1. **Problem & user value** — and the felt-improvement test vs incumbents (Principle II).
2. **Research** — how others solve it, Claude Code/SDK constraints, best practices (cited).
3. **Architecture** — engine modules, RPC surface, Rust core changes, UI.
4. **Data model** — types added to `@glaudecode/engine`.
5. **Edge cases & failure modes** — what breaks, what we do about it.
6. **Security** — secrets, process isolation, network exposure, extension privileges.
7. **Test plan** — unit (pure logic), integration, what needs manual/visual verification.
8. **Acceptance criteria** — observable, testable.
9. **Open questions** — unresolved decisions for the founder.

## Build order
A → B → C → D → E → F → G (dependency + value). A is foundational (multi-PTY); G is largest (cockpit).
The "walk away & trust it" cluster (A + C-approval + C-gauge + B-meta-agent) is the differentiation.
