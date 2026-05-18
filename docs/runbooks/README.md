# docs/runbooks/ — Operational procedures

**Purpose**: Step-by-step playbooks for repeatable operations. Each runbook is something a
on-call person (or future founder) needs to do under time pressure, with no improvisation.

**Naming**: `kebab-case-procedure.md`. Examples: `weekly-heartbeat.md`,
`cut-a-release.md`, `rotate-paid-tier-credential.md`, `respond-to-security-report.md`.

**Format**: every runbook MUST include:

1. **When to run this** — the trigger
2. **Pre-flight checks** — what must be true before starting
3. **Steps** — numbered, copy-pasteable, idempotent where possible
4. **Verification** — how to confirm the procedure worked
5. **Rollback** — what to do if a step fails

**Why runbooks vs guides**: guides are for routine work; runbooks are for high-stakes or
infrequent work where forgetting a step has real consequences (broken release, leaked
credential, downtime).

**First runbook expected**: `weekly-heartbeat.md` (first heartbeat due 2026-05-22).
