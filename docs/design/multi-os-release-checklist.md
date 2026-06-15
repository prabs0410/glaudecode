# Multi-OS release checklist (V5 Phase 6)

> Tiering: **macOS + Linux = Tier 1**, **Windows = experimental / WSL recommended**. WSL presents as
> Linux, so it inherits the Tier-1 Linux behavior for free. Most rows below are **HUMAN-GATE** — they
> need a real machine of that OS; the dev box is macOS, so `cargo check` here only compiles the macOS
> `cfg` arms (the Linux/Windows arms are verified by these QA passes).

## Build gate (every OS)

`bun test` (engine) · `bunx tsc --noEmit` (engine + desktop) · `bunx vite build` (desktop) ·
`cargo check` (Rust). All must be green on the target OS before release.

## Per-OS smoke

| OS | Shell integration | Keep-awake | Tailscale | Status |
|---|---|---|---|---|
| **macOS** (Tier 1, reference) | zsh ZDOTDIR (ships) | `caffeinate` | `tailscale` / `.app` bundle | ✅ built + checked here |
| **Linux** (Tier 1) | bash `--rcfile` + fish conf.d OSC 133/7 | `systemd-inhibit` (no-op on non-systemd) | `tailscale` on PATH | 🔶 HUMAN-GATE |
| **WSL** (= Tier-1 Linux) | inherits the Linux bash/fish path | n/a (host Windows sleeps) | host `tailscale.exe` | 🔶 HUMAN-GATE |
| **native Windows** (experimental) | none — PowerShell/cmd spawn plain | no-op | `tailscale.exe` / Program Files | 🔶 HUMAN-GATE |

### Linux smoke (HUMAN-GATE)
- [ ] A bash pane shows command duration/exit badges + cwd (OSC 133/7); `~/.bashrc` is **never** modified.
- [ ] A fish pane shows the same; the user's `config.fish` is **never** modified.
- [ ] `$SHELL`-less env falls back to a valid shell.
- [ ] WebKitGTK renders xterm.js + the OSC chips + the `/app` cockpit correctly.
- [ ] Enable remote → `systemd-inhibit --list` shows the lock → disable clears it; non-systemd degrades gracefully.

### native Windows smoke (HUMAN-GATE)
- [ ] A pane opens a working PowerShell (or cmd) shell — no crash on the missing `/bin/bash`.
- [ ] `tailscale_ip` finds Tailscale via the `.exe` / Program Files paths.
- [ ] The "use WSL for full features" note appears once and dismisses.
- [ ] Inside WSL, panes behave as Tier-1 Linux (bash/fish OSC integration works).

## Parity security review (Story 6.4.2 — HUMAN-GATE, mandatory)

Parity gaps are a **security** issue, not just a feature one. Before release, sign off that:
- [ ] each shell wrapper (zsh/bash/fish) sources the user's config but never leaks/mutates their env;
- [ ] transport discovery (`tailscale_ip` / serve) fails **safely + symmetrically** across OSes — no OS
      where a silent discovery failure downgrades the security posture;
- [ ] the native-Windows guards never enable a *less-safe* default than macOS/Linux.
