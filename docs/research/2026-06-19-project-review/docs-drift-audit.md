# Docs-drift audit — for the founder to apply (BACKLOG #39 / V7 task D12)

**Date:** 2026-06-19 · **Source:** the 2026-06-19 project review, finding #39 ("Docs honesty").
**As of commit:** `1f8c41d` on `feat/v6-conversation`.

## Why this is a flag-file, not direct edits

Every file that carries the drift below is **founder-curated** — `AGENTS.md` / `CLAUDE.md`
(symlinked) and `docs/INDEX.md` are written and revised by the founder, who reverts agent edits
to them (see memory `feedback-founder-curates-top-level-docs`). So this records the exact changes
to make rather than making them. Apply at your discretion.

> Note on Constitution Principle IX (a new `docs/` file must be indexed in `INDEX.md` in the same
> commit): this file itself is **not** self-indexed, for the same reason — it's listed under
> "missing from INDEX" below for you to add alongside the others.

## 1. Stale test count

`AGENTS.md:37` and `CLAUDE.md:37` both say `bun test` runs **"255+ tests"**. Actual, as of `1f8c41d`:

- **engine:** 441 tests across 54 files (`cd packages/engine && bun test`)
- **desktop:** 9 tests across 2 files (`cd packages/desktop && bun test` — added in V7/D10)
- **total: 450 tests across 56 files**

Suggested wording: `bun test` (450+ tests: 441 engine · 9 desktop). Also note the desktop suite now
exists and runs in the gate — the Verify line could mention `cd packages/desktop && bun test` and the
root `bun run verify` that chains the whole gate (added in B4 / repaired in V7).

## 2. New docs not yet in `docs/INDEX.md`

These were added during V6/V7 and should be indexed (each with a one-line purpose, per INDEX's convention):

- `docs/design/diagnostics-observability.md` — the observability-layer design (OBS-1…5).
- `docs/goal-v7/README.md` — the V7 runnable goal (observability + post-review hardening).
- `docs/research/2026-06-19-project-review/` — the 95-agent review output:
  `00-executive-summary.md`, `BACKLOG.md`, `competitive.md`, `edge-cases.md`, `enhancements.md`,
  `gaps.md`, `painpoints.md`, `risks-security.md`, and **this file** (`docs-drift-audit.md`).

(Older `goal-v5/`, `GOAL-V4.md`, `GOAL-V5.md`, and several `design/` docs also appear unindexed, but
those predate this review — listed here only so the gap is visible; indexing them is your call.)

## 3. Architecture "stub" repoint

`docs/architecture/README.md` is a *folder-purpose* README (it explains what belongs in
`docs/architecture/` and how it relates to ADRs) — there is **no long-form architecture document yet**,
and the README does **not** point readers to where the real architecture decision lives. Suggested
repoint: add a line directing readers to **`docs/adr/0004-system-architecture.md`** (the system
architecture of record) and note that a long-form companion doc is still TODO. This makes the stub
honest about being a placeholder instead of reading like the folder already holds the architecture.

---

*No code changed by this task — docs-only. The verify gate stays green.*
