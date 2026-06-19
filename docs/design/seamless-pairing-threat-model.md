# Seamless pairing — threat-model & go/no-go (WS4)

> **Status: decision doc, no code.** This exists so the founder can make an informed go/no-go on the
> "seamless pairing" relaxation. It builds on (does not replace) [`docs/security/threat-model.md`](../security/threat-model.md)
> and [`docs/design/epic-g-remote-threat-model.md`](./epic-g-remote-threat-model.md). Addresses the
> standing ask in memory `project-epic-g-remote-threat-model` (re-raise with detail).

## The proposed change (precisely)

Today, getting a phone to a place where it can **type into a terminal** (RCE-class) takes three
deliberate steps, each a friction point that's also a safety gate:

1. On the Mac, pick **Terminal** scope and accept a per-mint consent → a short pair code.
2. The phone redeems it for a **terminal**-scope token with a **1-hour** TTL (rolled forward only while
   a session is live; an idle one dies fast — design R8).
3. Each pane defaults to **not** accepting phone input; you **arm** it explicitly (📱 on its tab); the
   Rust core's per-pane `armed` set is the authoritative PTY-write gate, with an always-reachable
   kill-switch ("Disarm all").

"Seamless pairing" collapses all three:

- **Terminal-from-QR:** one QR scan grants terminal scope (no separate scope pick / per-mint consent).
- **30-day token:** the terminal TTL goes from 1h → 30d (no frequent re-pair).
- **Auto-arm:** panes are armed automatically whenever a trusted terminal device is paired (no per-pane
  arming step).

Net effect: **scan once → full, persistent, pre-armed remote code execution on the Mac for a month.**
That is the entire convenience win *and* the entire risk.

## What actually changes in the risk calculus

The threat that matters for this product is unchanged: **a remote device can run code on the user's
Mac.** What seamless pairing changes is not *whether* that's possible (it already is, via the deliberate
path) but **how cheap a single mistake becomes**:

| Dimension | Today | Seamless |
|---|---|---|
| Cost of granting RCE | 3 deliberate acts | 1 scan |
| Lifetime of a leaked terminal token | ≤ 1h idle | up to 30 days |
| State of panes when a device is paired | disarmed (safe default) | armed (live) |
| "Window of harm" from a lost phone | minutes (token expires) + must re-arm | up to 30 days, pre-armed |

So the relaxation trades **defense-in-depth** (multiple independent gates, short blast radius) for
**UX**. The job of this doc is to say what has to be true for that trade to be acceptable.

## Assets & adversaries (delta only — see the base docs for the full list)

- **Asset:** code execution on the Mac + everything Claude Code can reach (the repos, `~/.claude`, the
  shell). Unchanged.
- **In-scope adversaries for *this* change:**
  - **A1 — Lost/stolen unlocked phone.** The realistic #1 threat for a 30-day, pre-armed token.
  - **A2 — Someone on a *shared* tailnet** (a tailnet with other people/devices, or an over-broad ACL).
  - **A3 — Token theft/replay** (malware on the phone, a copied token, a shoulder-surfed QR).
  - **A4 — QR interception** (a QR shown on a screen others can see / photograph).
- **Out of scope (unchanged):** a compromised Mac (game over already), a malicious Tailscale, app-layer
  E2E crypto (deferred), nation-state.

## Threat scenarios under seamless pairing

**T1 — Lost/stolen phone (A1).** Without mitigation: the finder has a pre-armed, 30-day terminal session
to your Mac the moment they open the cockpit URL (the token is in the phone's `sessionStorage`; if the
phone is unlocked, it's theirs). **This is the dominant risk and the whole reason the review called it a
cliff.** Mitigation must make the token *useless on a different device* and/or *fast to kill remotely*.

**T2 — Shared tailnet (A2).** If the engine is reachable by any node on the tailnet (the current
fallback bind, or Serve without a tight ACL), another tailnet member can reach `/pair`/`/app`. They
still need a token, but a 30-day token + auto-arm means one leaked/guessed credential is durable and
immediately live. Mitigation: bind to the phone's node only (see `transport-acl-hardening.md`) — a hard
precondition, not optional, for seamless mode.

**T3 — Token theft / replay (A3).** A bearer token is a bearer token: whoever holds it is authorized.
Phone malware, a synced clipboard, or a backup that captures `sessionStorage` yields a usable token for
its full (now 30-day) life. Mitigation: **bind the token to the device** so a copied token alone is
insufficient (see "Device-bound tokens" below).

**T4 — QR interception (A4).** The pair code rides the URL **fragment** (`#code=…`), so it's not in
server logs/Referer — good. But a QR is a *visual* secret: anyone who photographs the screen during
pairing can redeem it (codes are single-use + 2-min TTL + rate-limited, so the window is small, but with
terminal-from-QR the prize is now RCE, not just view). Mitigation: keep the short code TTL; consider a
tap-to-confirm on the Mac *after* the phone redeems (out-of-band confirmation) for terminal scope.

## How C1 (this V8) already moved the needle

Phase 2 (C1) changed tokens to **HMAC-signed capabilities** with a **persisted device roster** as the
authority (`tokenSigning.ts` / `deviceStore.ts` / `pairing.ts`). For seamless pairing this matters a lot:

- **Revocation now survives an engine respawn.** Before, revocation was in-memory; a crash could
  resurrect access. Now "Revoke" removes the device from the persisted roster, and its signed token
  fails the presence check **even across restarts**. A 30-day token is only acceptable *because* remote
  kill is now durable.
- **The roster is the single chokepoint.** Auth = signature valid **and** device present **and**
  unexpired. That gives one clean place to add device-binding + per-device policy.
- **Forgery needs the signing key** (at rest 0600), so a 30-day token can't be minted by a phone.

C1 is therefore a **precondition that's already met**. It does not, by itself, fix T1/T3 (a *stolen*
valid token still verifies) — that needs device-binding.

## The key mitigation: device-bound tokens

Make a token verify **only from the device it was issued to**, so a copied/stolen token is inert
elsewhere. The roster already holds per-device records, so this is a natural extension:

- **At redeem:** the phone generates a keypair (WebCrypto, non-extractable private key in IndexedDB) and
  sends its **public key**; the engine stores it in the device record and binds the signed token to that
  device id.
- **At each request:** the phone signs a challenge (or a per-request nonce/timestamp) with its private
  key; the engine verifies against the stored public key. A token without a matching device-proof is
  rejected. (Lighter interim: bind to a stable device fingerprint + require the token only over the
  device's own tailnet node — weaker, but a stepping stone.)
- **Result:** T3 (copied token) and much of T1 (the finder has the token but not the non-extractable
  key — unless they have the *unlocked* phone, which is the irreducible "you lost an unlocked, logged-in
  device" case) are substantially mitigated.

This is the design that makes a 30-day terminal token defensible. **Without it, 30-day + auto-arm should
not ship.**

## Safety nets that MUST stay (non-negotiable)

Even in seamless mode, keep every existing backstop — they're what bounds a mistake:

- **The Rust per-pane `armed` set stays the authoritative PTY-write gate.** "Auto-arm" must mean the
  *desktop* keeps panes armed while a trusted device is paired (a WebView action over the existing
  `setPaneArmed`), **not** removing the Rust gate. The Mac-side kill-switch + defense-in-depth survive.
- **Always-reachable kill-switch** ("Disarm all" / disable remote) — the lost-phone recovery. With C1,
  revoke is durable; this is the front-line stop.
- **One-tap device revoke** on the Mac (already `LOCAL_ONLY`), now respawn-durable.
- **The full audit trail** (terminal-auth / arm / input byte-counts / disconnect) stays — incident
  review for "what did the lost phone do."
- **No `0.0.0.0` / TLS-or-refuse for non-loopback**, and **bind to the phone's node only** on a shared
  tailnet (`transport-acl-hardening.md`).

## Preconditions for "go" (all required)

1. **Device-bound tokens** implemented (a stolen token alone is inert). *Hard requirement.*
2. **Tailnet ACL pinned to the phone's node** (T2 closed), enforced/checked when seamless mode is on.
3. **The Rust arming gate + kill-switch + durable revoke** retained exactly (auto-arm = desktop-driven,
   not gate removal).
4. **A visible "this device has 30-day terminal access" indicator** + an easy revoke, so the elevated
   state is never invisible (observability-first).
5. **Per-device opt-in:** seamless/30-day is a *choice per device*, not the global default; the
   deliberate path stays available.

## Recommendation

**Conditional GO — but staged, not as one flag.**

- **Now (safe, ship-able):** the parts that don't widen RCE — QR-to-pair UX polish, the device roster +
  durable revoke (done in C1), the device list/indicator. These improve UX with no new risk.
- **Next, gated on device-bound tokens:** raise the terminal TTL toward 30 days **only after** tokens
  are device-bound and the tailnet ACL pin is enforced. A 30-day **bearer** token (no binding) is a
  no-go — it turns a lost phone into a month of RCE.
- **Auto-arm:** acceptable **only** as a desktop-kept-armed convenience (Rust gate intact) **and** with
  the visible elevated-access indicator + one-tap disarm. Never as removal of the arming gate.

In short: **C1 unlocked the durable-revoke precondition; device-bound tokens are the remaining gate.**
Do the no-risk UX now; hold the TTL extension + auto-arm until device-binding lands. The founder decides
whether to fund device-bound tokens next (it's the linchpin).

---

*Implementation is a separate goal, gated on this go/no-go. Listed for `docs/INDEX.md` in the
`docs-drift-audit` note (the founder curates INDEX).*
