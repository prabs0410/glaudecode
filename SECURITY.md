# Security Policy

GlaudeCode lets you drive your machine — and Claude Code — from your phone. When remote access is
enabled, **a paired device can run commands on your computer (remote code execution)**. We take that
seriously. This policy explains how to report a vulnerability and what to expect.

## Reporting a vulnerability

**Please report privately — never in a public issue, PR, or discussion.**

- **Preferred:** GitHub **private vulnerability reporting** — on this repo, go to the **Security** tab
  → **Report a vulnerability**. This is end-to-end private to the maintainers (no PGP needed).
- **Email fallback:** if you can't use GitHub's flow, email the maintainer (address in the repo
  profile). For sensitive details, request our PGP key in your first message and we'll reply with it.

Please include: affected version/commit, a description, reproduction steps or a PoC, and the impact
you observed. A minimal PoC dramatically speeds triage.

## What to expect (coordinated disclosure)

- **Acknowledgement** within **72 hours**.
- A **fix or mitigation timeline** within ~1 week of triage; target **90 days** to a fix for confirmed
  issues, sooner for actively-exploitable ones.
- We'll **coordinate disclosure** with you and credit you (if you wish) in the advisory and release
  notes. Please give us a reasonable window before any public disclosure.
- Confirmed vulnerabilities are published as **GitHub Security Advisories (GHSA)** and indexed on our
  [security bulletins page](docs/security/bulletins.md).

## Safe harbor

We welcome good-faith security research. If you make a good-faith effort to comply with this policy —
testing only **your own** instances/devices, avoiding privacy violations and service disruption, and
giving us reasonable time to respond — we will **not** pursue or support legal action against you, and
we consider your research authorized. If in doubt about scope, ask first via the private channel.

## Scope

**In scope:** the engine (pairing, scoped tokens, the `terminal` RCE scope + per-pane arming, the
remote listener / Tailscale Serve path, the WebSocket auth), the desktop app, and the cockpit.

**Out of scope (your responsibility — see [docs/security/threat-model.md](docs/security/threat-model.md)):**
your tailnet/transport configuration, the devices you pair, your OS/account security, and any
self-hosted relay you run. We ship secure defaults and signed updates; you own your mesh, devices, and
keeping current. We run **no servers** — there is no hosted GlaudeCode service to attack.

## Supported versions

GlaudeCode is pre-1.0; only the latest release receives security fixes.

| Version | Supported |
|---|---|
| latest release | ✅ |
| older | ❌ — please update |
