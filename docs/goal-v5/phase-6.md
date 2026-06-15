# Phase 6 — Multi-OS  ·  me-first #4  ·  `feat/v5-multi-os`

> Reading outline. **`README.md` is authoritative + what the loop runs** — see its Phase 6 section for full Files / Sub-tasks / Verify / Review per task.

Linux → Tier 1 (bash + fish OSC 133/7 replicating the zsh model, OS-aware `$SHELL` fallback, WebKitGTK QA, `systemd-inhibit` keep-awake); macOS stays the reference. **Windows = experimental/WSL**: light native guards only (cmd/PowerShell fallback, Tailscale `.exe` discovery, "use WSL" note) — WSL inherits the Linux work for free; no native PowerShell OSC, no signed MSI. Design: `oss-at-scale-strategy.md` §6.

- **Story 6.1 — Linux bash + fish shell integration (OSC 133/7)**
  - 6.1.1 bash OSC 133/7 via a non-invasive `--rcfile` wrapper [🏗] · [HUMAN-GATE: real Linux QA, `~/.bashrc` untouched]
  - 6.1.2 fish OSC 133/7 via `fish_preexec`/`fish_postexec` [🔨] · [HUMAN-GATE: real Linux fish QA]
  - 6.1.3 OS-aware `$SHELL` fallback + WebKitGTK QA [🔨] · [HUMAN-GATE: real Linux/WebKitGTK QA]
- **Story 6.2 — Linux `systemd-inhibit` keep-awake (fills the Phase-5 interface)**
  - 6.2.1 Linux backend for the shared `keep_awake.rs` [🔨] · [HUMAN-GATE: real Linux systemd/non-systemd QA]
- **Story 6.3 — Windows experimental/WSL guards (light native only)**
  - 6.3.1 cmd/PowerShell shell fallback (don't break on missing `/bin/bash`) [🔨] · [HUMAN-GATE: native-Windows QA]
  - 6.3.2 Tailscale `.exe`/Program Files discovery [⚡] · [HUMAN-GATE: Windows-with-Tailscale QA]
  - 6.3.3 In-app "use WSL for full features" note [⚡] · [FOUNDER-DECISION: experimental/WSL decided; copy flagged]
- **Story 6.4 — Per-OS release gate**
  - 6.4.1 Per-OS smoke + build matrix [🔨]
  - 6.4.2 Shell-wrapper + transport-discovery parity security review [🔨] · [HUMAN-GATE: sign-off across all 3 OSes]
