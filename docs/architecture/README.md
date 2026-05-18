# docs/architecture/ — System Design (long-form)

**Purpose**: Long-form architecture docs that go beyond ADR length. Diagrams, data-flow
walk-throughs, component contracts, sequence diagrams, deployment topologies.

**Naming**: `kebab-case-topic.md`. No numbering — these documents evolve over time.

**Relationship to ADRs**:
- ADRs make decisions; architecture docs describe systems.
- Architecture docs cite ADRs that constrain them.
- Architecture docs MUST NOT contradict ADRs. When a contradiction is needed, write a new
  ADR first that supersedes the conflicting older one.

**When to add**:
- A subsystem grows complex enough that a future maintainer needs more than commit history
  to understand it.
- A diagram or topology is worth committing alongside the code.

**What doesn't go here**:
- One-off decisions (use ADRs).
- API references (use `docs/api/`).
- Step-by-step ops procedures (use `docs/runbooks/`).
