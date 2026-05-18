# Open Questions

Running list of unresolved decisions. Status legend:

- `[OPEN]` — actively unresolved, action implied
- `[DEFERRED]` — known answer-later, blocked or low priority
- `[ANSWERED]` — resolved; link to the ADR or commit that locked the answer

When a question is answered, leave the entry here with the `[ANSWERED]` tag and a link. Do not delete — answered questions teach the next reader why the answer is what it is.

---

## Q1 — Update "Current focus" line in AGENTS.md? `[OPEN]`

**Context:** AGENTS.md still says *"Drafting the constitution via `/speckit.constitution`. See `.specify/memory/constitution.md` once created."* — that's stale (constitution is ratified v1.0.0). Was raised mid-session 2026-05-18, user did not respond explicitly.

**Next action:** When user commits AGENTS.md pending edits, decide whether to update this line in the same commit or leave the staleness deliberate (as a way to mark active focus elsewhere).

## Q2 — Migrate Hub-level research into `docs/research/`? `[OPEN]`

**Context:** Research from prior sessions lives at `~/Hub/docs/research/` (cli-landscape, dev-frameworks, etc.). It informed GlaudeCode's positioning but lives outside this repo. Three options: (a) copy relevant parts in, (b) symlink, (c) leave external with reference in INDEX.md.

**Next action:** Pick one. If (a), do the migration in a single commit with attribution.

## Q3 — Add a memory-pointer in AGENTS.md? `[OPEN]`

**Context:** The Claude Code auto-memory at `~/.claude/projects/.../memory/` already accumulates. Other agent tools (Cursor with rules, Codex with memory) may have similar systems. Should AGENTS.md mention the memory directory exists so cross-tool agents know to look or replicate?

**Next action:** Decide whether to add a "Memory" section to AGENTS.md alongside "Git identity" and "Documentation Index."

## Q4 — `docs/experiments/` as its own folder, or fold into `docs/research/technical/`? `[OPEN]`

**Context:** When a code spike runs for a feature design (e.g., "test jiti loader behavior under our shape"), the writeup could be either "technical research" or its own thing. Right now both fit. Picking before the first spike prevents drift.

**Next action:** Decide before the first V1 feature implementation begins.

## Q5 — Harden ADR 0002's soft Pi-readability commitment to MUST or SHOULD? `[OPEN]`

**Context:** ADR 0002 says GlaudeCode sessions SHOULD be readable by Pi (soft compatibility goal). When does this become a MUST? When does it become "abandoned"? Without a trigger, soft goals erode silently.

**Next action:** Revisit when V1 session-storage implementation begins. Decide based on whether the additional fields (`peerSessionId`, etc.) break Pi's loader.
