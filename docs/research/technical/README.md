# docs/research/technical/ — Library, framework, and integration evaluation

**Purpose**: Investigative output for technical choices. Library shootouts, framework
evaluations, integration spikes, performance benchmarks, architecture-experiment writeups.

**Per-doc structure**: each file SHOULD include:

1. Question being investigated
2. Options considered
3. Evaluation criteria
4. Findings (with evidence — links, benchmarks, screenshots)
5. Recommendation (if any)
6. Open questions

**Naming**: `kebab-case-topic.md`. Examples: `session-storage-format.md`,
`rpc-transport-options.md`, `extension-loader-comparison.md`.

**When to add**:
- A V1 stack decision needs evidence beyond intuition.
- An integration spike produces findings worth keeping.
- A performance investigation surfaces a non-obvious bottleneck.

**Relationship to ADRs**: technical research often becomes input for an ADR. The ADR
references the research; the research lives here unchanged so its provenance survives.
