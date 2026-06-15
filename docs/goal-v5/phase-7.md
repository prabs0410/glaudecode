# Phase 7 — OSS launch governance gate  ·  me-first #5  ·  `feat/v5-governance`

> Reading outline. **`README.md` is authoritative + what the loop runs** — see its Phase 7 section for full Files / Sub-tasks / Verify / Review per task.

Convert a one-person posture into one that survives non-expert operators on shared networks: private reporting, a public expanded threat model, a CI gate that fails the build on a secure-default regression, signed releases with a pinned-key auto-updater, and a blunt first-run RCE consent. All net-new (`SECURITY.md`, `docs/security/`, `.github/`, updater config absent today). Design: `oss-at-scale-strategy.md` §7 + §2.

- **Story 7.1 — Public security reporting & threat model**
  - 7.1.1 `SECURITY.md` (private reporting, never the public tracker) [⚡] · [FOUNDER-DECISION: managed relay = NO]
  - 7.1.2 Promote + expand the threat model → public `docs/security/threat-model.md` [⚡]
- **Story 7.2 — RPC scope classification completeness (Phase-2 deferred LOW + gate teeth)**
  - 7.2.1 Forward-looking `TERMINAL_ONLY_METHODS` tier (empty today; terminal RCE is WS-gated) [🔨]
  - 7.2.2 Exhaustive-classification test — every method in exactly one tier, empty-terminal-tolerant [🔨]
- **Story 7.3 — Secure-defaults CI release gate (blocks the build)**
  - 7.3.1 GitHub Actions CI workflow [🔨]
  - 7.3.2 Encode every secure-default as a release-blocking assertion (incl. R8 TTL ≤1h, non-loopback-E2E) [🔨]
- **Story 7.4 — Signed releases + verified auto-updater (P0)**
  - 7.4.1 Tauri updater verifies against a PINNED key [🏗]
  - 7.4.2 Sign every release + SBOM + SLSA level [🏗]
  - 7.4.3 Provision the signing trust-root + CI wiring [⚡] · [HUMAN-GATE (release-blocking): maintainer holds the trust-root]
- **Story 7.5 — First-run "remote shell is RCE" consent (not skippable)**
  - 7.5.1 Blunt RCE consent before the first remote bind [🔨]
- **Story 7.6 — Post-launch trust-builders (tracked, non-blocking)**
  - 7.6.1 OpenSSF badge, bulletins page, adoption-gated audit [⚡] · [HUMAN-GATE (post-adoption, non-blocking): third-party audit]
