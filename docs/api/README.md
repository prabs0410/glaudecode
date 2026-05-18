# docs/api/ — Public surface reference

**Purpose**: Reference documentation for the versioned public surface declared in
Constitution Principle VI:

- CLI commands and flags
- Configuration schema (`AGENTS.md` reading, `settings.json` shape)
- Hook signatures (lifecycle event payloads per ADR 0002)
- AGENTS.md format conventions

**Naming**: `kebab-case-surface.md`. Examples: `cli-commands.md`, `config-schema.md`,
`hook-signatures.md`, `agentsmd-format.md`.

**Generated vs hand-written**: prefer generation where possible (from source-of-truth
schemas or doc-comments). Hand-written docs go here only to clarify contracts that the
generator cannot capture.

**Versioning**: this folder MUST follow Constitution Principle VI. Breaking changes in v0.x
are fine; in v1.0+ they require a deprecation window documented in the relevant API page.

**Cross-reference**: every API page should link to the ADR that locked its design (if any).
