# docs/handoffs/ — Session transition documents

**Purpose**: Terminal-state captures when a session ends — either because the context window filled, because a working block is wrapping up, or because the next session will be in a different tool / on a different machine.

**Naming**: `YYYY-MM-DD-headline-slug.md`. One file per handoff. Do not edit after the writing session ends — the date and slug are the handoff's identity.

**Required content**: every handoff MUST contain enough context for a fresh agent (or returning human) to pick up cold:

1. **What this is** — one-paragraph project orientation
2. **Locked decisions** — what cannot be re-litigated (cite where they live)
3. **In-flight state** — what was being worked on, what's pending, what's blocked
4. **Immediate next action** — the very first thing the next session should do
5. **Critical context to NOT forget** — reframes, gotchas, learned lessons
6. **Reference paths** — pointers to authoritative locations

**Relationship to `state.md`**:
- `docs/state.md` is **continuous** — updated every working session, captures live state
- `docs/handoffs/` is **terminal** — frozen at a point in time, written when a session ends, never edited after
- A handoff is essentially a snapshot of `state.md` plus context the next agent needs

**When to write a handoff**:
- Context window is approaching saturation
- A major work unit is wrapping (e.g., constitution ratified, V1 shipped)
- Work is transitioning to a different tool, machine, or human
- A long pause is anticipated before next session

**Current handoffs**:
- `2026-05-18-bootstrap-to-glaudecode.md` — the handoff that bootstrapped the constitution-ratification session
