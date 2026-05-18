# Current State

**Last updated:** 2026-05-18 (post docs-scaffold)
**Update protocol:** Refresh the three sections below at the end of every meaningful work unit. Stale state is worse than no state — if a section is unchanged for >2 working sessions, prune it.

---

## Locked

Things decided. Don't relitigate. Cross-reference where it lives.

- **Constitution v1.0.0** — `.specify/memory/constitution.md`, ratified 2026-05-18. Source: ADR 0001.
- **10 constitution principles** — ADR 0001 at `docs/adr/0001-constitution-principles.md`.
- **5 Pi-inspired design conventions** — ADR 0002 at `docs/adr/0002-adopt-pi-design-conventions.md`. Binds feature specs #5, #6, #9 and remote-cockpit features.
- **Apache 2.0 license** — Principle IV, non-negotiable.
- **OSS / paid split** — local vs cross-machine, feature parity (Principle V).
- **Weekly heartbeat** — Friday publishing rhythm; first heartbeat due 2026-05-22 (Principle VII).
- **AGENTS.md as memory standard** — `AGENTS.md` ↔ `CLAUDE.md` symlink. Every spec MUST update it (Principle IX).
- **Git identity for this repo** — local config: `192090657+prabs0410@users.noreply.github.com`. SSH via `github-personal` alias. See AGENTS.md "Git identity" section.
- **Docs structure** — `docs/INDEX.md` is single source of truth. 10 folders pre-created; 6 future folders documented with triggers.
- **Memory: discuss before executing nested decisions** — `~/.claude/projects/.../memory/feedback-discuss-before-executing-nested-decisions.md`.

## In flight

Active work. Things touched in the current or last working session.

- **AGENTS.md pending commit.** Three uncommitted edits cohered: (1) interaction rules added by user, (2) "Git identity (LOAD-BEARING)" section, (3) "Documentation Index" section, (4) (this session) "Current state" pointer. ~90+ lines of pending changes.
- **Unpushed commits** to `origin/main`: Pi ADR + research (`7f5139e`), docs scaffold (`3ad303d`), and now the working-memory artifacts commit (about to land). All earlier commits — including constitution v1.0.0 — were already force-pushed during the git-identity rewrite.

## Next

What comes after current work. Concrete, not aspirational.

- **Commit AGENTS.md** with the 4 cohered edits (user's call when).
- **Push 5 commits** to `origin/main`.
- **Pick first V1 feature** for the Spec-Kit pipeline. 9 candidates locked; ordering not yet decided. Loop: `Skill brainstorming` → `/speckit.specify` → `/speckit.clarify` → `/speckit.plan` → `/speckit.tasks`.
- **Write 2026-05-22 heartbeat** — first Friday heartbeat post (Principle VII). Lives in `docs/marketing/heartbeats/` (subfolder created on first heartbeat).
- **Resolve open questions** — see `docs/open-questions.md` (5 active questions).
