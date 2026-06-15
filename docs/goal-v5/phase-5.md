# Phase 5 — Transport & onboarding  ·  me-first #2  ·  `feat/v5-transport`

> Reading outline. **`README.md` is authoritative + what the loop runs** — see its Phase 5 section for full Files / Sub-tasks / Verify / Review per task.

Blessed path = Tailscale Serve → installable PWA over real `wss://`, reachable in one QR scan, with the plain-tailnet bind as the zero-config fallback. Self-host relay *recipe* (no managed relay), tailnet ACL hardening, cross-platform keep-awake. Design: `docs/design/transport-options-phone-to-mac.md`, `oss-at-scale-strategy.md` §3–§4.

- **Story 5.1 — Tailscale Serve as the blessed default**
  - 5.1.1 `tailscale serve` lifecycle in Rust (start/stop/status) [🔨] · [HUMAN-GATE: admin enables MagicDNS + HTTPS certs]
  - 5.1.2 Expose Serve as a desktop-only RPC + wire the bind [🔨] · (classify `local` or it fails the Phase 7 gate)
  - 5.1.3 Cockpit becomes a real installable PWA over `wss://` [⚡] · [HUMAN-GATE: real-device Add-to-Home-Screen + wss]
- **Story 5.2 — QR pairing onboarding ("Connect my phone")**
  - 5.2.1 Generate the QR in the desktop PairingModal [🔨] · [FOUNDER-DECISION: CTA wording — flag]
  - 5.2.2 Cockpit auto-pairs from the URL fragment [⚡]
- **Story 5.3 — Keep-awake while remote is enabled (NET-NEW, BUILD ONCE)**
  - 5.3.1 Cross-platform `keep_awake.rs` + macOS `caffeinate` backend [🔨] · [FOUNDER-DECISION: ON only while remote enabled] · (Phase 6/6.2 fills the Linux backend behind this interface)
- **Story 5.4 — Self-host relay recipe + transport hardening docs (NO managed relay)**
  - 5.4.1 Self-host relay recipe (code + docs, community-run) [🏗] · [FOUNDER-DECISION: managed relay → NO at launch]
  - 5.4.2 Tailnet ACL hardening snippet + loud-caveat opt-ins [🔨] · [HUMAN-GATE: validate ACL on a multi-node tailnet]
