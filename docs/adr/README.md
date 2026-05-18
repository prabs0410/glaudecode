# docs/adr/ — Architectural Decision Records

**Purpose**: Numbered, immutable architectural decisions. Each ADR captures the context,
decision, alternatives considered, and consequences. ADRs interpret and extend the
constitution; they cannot contradict it.

**Naming**: `NNNN-kebab-case-title.md`. Numbers are sequential and never reused. Once an
ADR is committed, its content is amended only by a follow-up ADR that supersedes or amends
it (referenced in the new ADR's frontmatter).

**Status values**: `Proposed`, `Accepted`, `Superseded by ADR NNNN`, `Deprecated`.

**When to add an ADR**:
- A choice between two or more architectural alternatives where future maintainers should
  not have to re-litigate the reasoning.
- A convention adopted from another project (e.g., ADR 0002 adopting Pi conventions).
- An amendment to the constitution (per Governance section of `.specify/memory/constitution.md`).

**What doesn't go here**:
- Tactical bug-fix notes (use the commit message).
- Feature specifications (use `.specify/specs/`).
- Long-form architecture (use `docs/architecture/`).
- Research and analysis (use `docs/research/`).

**Current ADRs**:
- `0001-constitution-principles.md` — locked the 10 constitution principles
- `0002-adopt-pi-design-conventions.md` — adopted 5 Pi-inspired conventions
