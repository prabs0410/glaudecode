# GlaudeCode Documentation Index

**Single source of truth for everything under `docs/`.** This file is referenced from
`AGENTS.md` so any agent (Claude Code, Codex CLI, Cursor, Windsurf, GitHub Copilot) can
navigate the project without scanning the tree.

**Rule**: every new file added under `docs/` MUST also appear in this index in the same
commit. Specs that touch `docs/` MUST update this index per Constitution Principle IX.

---

## Authoritative locations OUTSIDE `docs/`

These live elsewhere by convention. Do not duplicate them under `docs/`.

| Location | Purpose |
|---|---|
| `.specify/memory/constitution.md` | The constitution (v1.0.0 ratified 2026-05-18) |
| `.specify/specs/` | Feature specifications (Spec-Kit pipeline output) |
| `AGENTS.md` (symlink → `CLAUDE.md`) | Cross-tool agent memory |
| `README.md` | Public-facing pitch |
| `LICENSE`, `NOTICE` | Legal artifacts |
| `CHANGELOG.md` *(future, repo root)* | Release notes per version |

---

## Current folders under `docs/`

### `docs/adr/` — Architectural Decision Records
Numbered, immutable decisions. Each ADR captures context, decision, alternatives, and
consequences. Naming: `NNNN-kebab-case-title.md`, sequential, never reused.
- `0001-constitution-principles.md` — locks the 10 constitution principles
- `0002-adopt-pi-design-conventions.md` — adopts Pi-inspired lifecycle events, JSONL tree
  storage, fork verb split, steering primitives, jiti extensions
- README: [adr/README.md](adr/README.md)

### `docs/architecture/` — System design (long-form)
Long-form system design docs that go beyond ADR length. Diagrams, data-flow walk-throughs,
component contracts. ADRs reference architecture docs; architecture docs do not contradict ADRs.
- *(empty — first doc lands when V1 implementation begins)*
- README: [architecture/README.md](architecture/README.md)

### `docs/research/` — Investigation outputs
Research outputs that inform design decisions. Three subfolders:

- `docs/research/competitive/` — competitor and adjacent-product analysis
  - `pi.md` — Pi (`@earendil-works/pi-coding-agent`) competitive research (2026-05-18)
  - README: [research/competitive/README.md](research/competitive/README.md)
- `docs/research/market/` — TAM, user research, pricing analysis
  - *(empty — first artifact when pricing for the paid hosted tier needs validation)*
  - README: [research/market/README.md](research/market/README.md)
- `docs/research/technical/` — library/framework evaluation, integration spikes
  - *(empty — first artifact when V1 stack questions need resolution)*
  - README: [research/technical/README.md](research/technical/README.md)

README at root: [research/README.md](research/README.md)

### `docs/guides/` — How-to documentation
Two audiences:

- `docs/guides/user/` — end-user how-tos (install, configure, common workflows)
  - *(empty until V1 has anything to install)*
  - README: [guides/user/README.md](guides/user/README.md)
- `docs/guides/contributor/` — contributor how-tos (dev setup, testing, releasing)
  - *(empty until first external contributor or before — whichever comes first)*
  - README: [guides/contributor/README.md](guides/contributor/README.md)

README at root: [guides/README.md](guides/README.md)

### `docs/api/` — Public surface reference
Reference docs for the versioned public surface per Constitution Principle VI: CLI
commands, configuration schema, hook signatures, AGENTS.md format. Auto-generated where
possible; hand-written contract clarifications go here too.
- *(empty — first doc lands with the V1 CLI surface)*
- README: [api/README.md](api/README.md)

### `docs/runbooks/` — Operational procedures
Step-by-step playbooks for repeatable operations: cutting a release, responding to a
security report, rotating a credential, debugging the paid-tier orchestrator.
- *(empty — first runbook is the weekly heartbeat process)*
- README: [runbooks/README.md](runbooks/README.md)

### `docs/marketing/` — Build-in-public artifacts
Heartbeat archives (per Constitution Principle VII), blog drafts, launch posts, demo
scripts, dev-log content. Not the website source — only artifacts that benefit from being
versioned with the code.
- *(empty — first artifact is the 2026-05-22 heartbeat post)*
- README: [marketing/README.md](marketing/README.md)

---

## Future folders (anticipated, NOT yet created)

Create on the trigger event listed. Avoid pre-creating to prevent dead-tree clutter.

| Folder | Trigger to create | First likely contents |
|---|---|---|
| `docs/security/` | Before v1.0 release, or before first paid customer (whichever first) | Threat model, security policy, vulnerability disclosure process |
| `docs/legal/` | When first external contributor lands meaningful work | CLA discussion, third-party license review, attribution policy |
| `docs/branding/` | When public website launches | Logo files, color palette, typography, voice & tone |
| `docs/feedback/` | When first non-founder user surfaces feedback | User interview notes, support patterns, feature-request triage |
| `docs/postmortems/` | After first user-visible incident | Incident timelines, root-cause analyses, follow-up tracking |
| `docs/integrations/` | When integrating with a second host harness (Pi, Codex CLI) | Per-harness integration notes, schema mappings |

When creating any of these, **first add an entry to this INDEX and the per-folder README in
the same commit.**

---

## Conventions

1. **Every doc lives somewhere on this map.** If a doc doesn't fit, propose a new folder
   *and* update this INDEX; do not create one-off top-level files under `docs/`.
2. **READMEs are authoritative for their folder.** When folder purpose evolves, update both
   the README and this INDEX.
3. **Cross-link aggressively.** ADRs cite research notes; research notes cite ADRs; specs
   cite both. Future agents follow these links instead of full-text searching.
4. **Date and source-attribute research.** Every research doc starts with `**Date:**` and
   `**Source:**` lines. Old research stays useful only if its provenance is clear.
5. **Prefer one canonical doc per topic.** If two docs cover the same topic, merge or
   delete one. Conflicting docs are worse than missing docs.
