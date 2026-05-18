# docs/notes/ — Working memory

**Purpose**: Topic-based working memory. Half-formed thinking that's not ADR-ready, not a finished research artifact, not an architecture doc. The messy middle.

**Format**: one file per topic. Files accumulate over time as thinking evolves on that topic.

**Naming**: `kebab-case-topic.md`. Examples: `cockpit-architecture.md`, `paid-tier-rollout.md`, `feature-5-fork-semantics.md`.

**Lifecycle**:
1. Created when a topic needs running thinking that exceeds a single chat session.
2. Grows over multiple sessions.
3. Either:
   - Crystallizes — a section graduates into an ADR / research note / architecture doc, leaving a reference behind, **or**
   - Becomes irrelevant — deleted (do not let dead notes accumulate)

**When NOT to use**:
- Decisions are locked → use `docs/adr/`
- Investigation is complete and source-attributed → use `docs/research/`
- It's a session-end snapshot for handoff → use `docs/handoffs/`
- It's the live "where are we" status → use `docs/state.md`

**Open-question convention**: each note SHOULD include an "Open questions" section at the bottom. Questions promoted out of a note land in `docs/open-questions.md` only if they have project-wide consequence.
