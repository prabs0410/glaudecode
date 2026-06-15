# GlaudeCode threat model (public)

> Promoted + expanded from the internal `docs/design/epic-g-remote-threat-model.md` for the
> multi-user / open-source reality (V5 Phase 7.1.2). Versioned with the project; updated as the remote
> surface changes. If you find a gap, see [SECURITY.md](../../SECURITY.md).

## The asset, stated plainly

When remote access is on, GlaudeCode is a **bidirectional terminal mirror**: a paired phone can both
*see* your terminals and *type into armed ones*. Typing into a shell is **arbitrary remote code
execution** on your machine. Everything below exists to make that capability **explicit, scoped,
opt-in, revocable, and confidential** — never ambient.

## Who and where (the realistic defaults for an OSS tool)

Unlike a single-developer tool, we assume the **default operator is non-expert** and the **default
network is shared / untrusted** (a work or family tailnet, a coffee-shop tunnel). Defaults must be
safe for that person, not just for an expert on a private tailnet.

## Trust boundaries

1. **Engine ↔ localhost.** The engine binds `127.0.0.1` by default with a per-launch bearer token.
   The Rust core owns the PTYs; the engine never gets the bearer onto a phone.
2. **Engine ↔ phone (remote).** Opt-in only. Phones authenticate with **scoped, expiring, revocable
   pairing tokens** — never the bearer. The bearer-only Rust↔engine bridges are the sole PTY ingress.
3. **Scope + arming.** `view < steer < terminal`. Only a `terminal` token may type, and only into a
   pane the desktop has **armed** (default OFF). Enforced at the engine **and** re-checked
   authoritatively in the Rust core before any PTY write.
4. **OS account / secret storage.** macOS Keychain protects secrets at rest; **Linux/Windows do not
   have the same guarantees** — treat those hosts accordingly.

## Threats and mitigations

| Threat | Mitigation | Status |
|---|---|---|
| Brute-force the pairing code | short-lived single-use codes, widened entropy, **/pair rate-limit + lockout** (2/min, 12/hr) | shipped (Phase 0) |
| Stolen pairing token | scoped, **expiring** (terminal ≤1h, rolled only while live), **revocable** (cuts live sessions ≤2s + per-keystroke re-verify), never in the URL/query | shipped (Phase 0/2/3.3) |
| Unauthorized keystrokes | `terminal` scope (never implied by steer) **+ per-pane arming, default OFF + dual engine/Rust gates + one-tap kill switch** | shipped (Phase 2) |
| Resize / control frames as an RCE side-channel | gated **identically** to keystrokes | shipped (Phase 4) |
| Over-broad network exposure | wildcard binds **rejected**; non-loopback bind requires app-layer E2E | partial — wildcard shipped (Phase 0); E2E gate is Phase 3 |
| Transport eavesdropping / a relay reading keystrokes | Tailscale **WireGuard** end-to-end on your own tailnet; **app-layer E2E (SPAKE2+Noise/AEAD)** so even the transport sees only ciphertext | **Phase 3 — NOT YET; until then, any tunnel/relay that terminates TLS sees plaintext** |
| Shared-tailnet exposure (any node hits the engine) | deny-by-default tailnet ACL scoping the engine to your phone's node | docs shipped (Phase 5); **your action** |
| Malicious / tricked auto-update (mass RCE) | **signed releases + an updater that verifies against a pinned key** | Phase 7.4 — config shipped; signing trust-root is a maintainer action |

## Shared-responsibility split (the Tailscale model)

**We secure:** the engine, pairing, scoped tokens, the arming/gate logic, the secure defaults (CI-
enforced), and — once it ships — signed updates verified against a pinned key.

**You own:** your transport/tailnet config and ACLs, the devices you pair (and de-pairing lost ones),
your OS/account security, any self-hosted relay you run, and **staying current** (apply updates).

We run **no servers**. There is no hosted GlaudeCode to compromise.

## Honest residual risk

- **The crypto stack is pending an independent review.** Phase 3's SPAKE2/Noise/AEAD uses unaudited/
  beta libraries; the *protocol* mirrors Magic Wormhole, but the *implementation* is **not** to be
  trusted for public, untrusted-transport use until the **independent crypto review (Phase 3.5)**
  clears. Until then, GlaudeCode is safe for **personal use over your own Tailscale**, not for routing
  keystrokes through infrastructure you don't control.
- A **continuously-connected** stolen `terminal` token stays alive (rolled forward) — but it is a
  *visible, revocable* live session; the short TTL bites a token that isn't continuously connected.
- **Windows/Linux** lack the macOS Keychain/ZDOTDIR isolation; shell-wrapper + transport-discovery
  parity is itself reviewed as a security property (Phase 6.4.2), because a hasty re-port is where
  weak-default bugs are born.
