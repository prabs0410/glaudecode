# docs/research/ — Investigation outputs

**Purpose**: Captured research that informs design decisions. Three subfolders:

- `competitive/` — competitor and adjacent-product analysis
- `market/` — TAM, user research, pricing analysis
- `technical/` — library/framework evaluation, integration spikes

**Per-doc requirements**: every research doc opens with:

```
**Date**: YYYY-MM-DD
**Source**: URL or attribution
**Researcher**: name or session reference
```

Without provenance, old research becomes unreliable. Provenance is mandatory.

**When research becomes an ADR**: research informs decisions; decisions are recorded as
ADRs. A research doc should be referenced from any ADR it influenced. Research without an
ADR is fine — not every investigation needs a decision attached.

**Naming**: `kebab-case-topic.md` within each subfolder. Date is in the frontmatter, not
the filename — research updates in place.

**Stale research**: if a research doc no longer reflects reality, either update it (add a
new dated section) or move it to an archive and write a new doc. Do not delete — old
research has audit value.
