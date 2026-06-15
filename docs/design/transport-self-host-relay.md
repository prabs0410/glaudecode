# Self-host relay recipe (you run it, we don't)

> V5 Phase 5 / Story 5.4.1. The blessed path is **Tailscale Serve** (see
> `transport-options-phone-to-mac.md`). This doc is the fallback for when the phone can't be a
> tailnet node, or you want a stable entry point without exposing the engine to the public internet
> via Funnel. **GlaudeCode ships this recipe; it does not run any relay** (the Syncthing model).

## The hard rule first

The engine↔phone stream is a **bidirectional keystroke mirror = remote code execution**. A relay you
run is a machine in the middle of that stream.

- **Until V5 Phase 3 (app-layer E2E crypto) ships, a relay/VPS sees _plaintext_.** Only the transport
  (WireGuard / TLS) protects each hop; the relay box itself can read and inject keystrokes. So before
  Phase 3, only relay through a host **you fully trust and control**, and prefer a transparent L4
  (TCP) forward over anything that terminates TLS.
- **After Phase 3**, the relay carries **ciphertext only** (the SPAKE2+Noise/AEAD session is opaque to
  it) — that is the configuration this recipe is designed for.

## Recipe A — WireGuard point-to-point (simplest, most private)

A $4/mo VPS as a WireGuard peer that forwards one port to your Mac. The VPS never terminates TLS; it
forwards encrypted WireGuard packets. This is effectively "roll your own tailnet of two".

1. VPS: install WireGuard, create an interface with a static key; allow your Mac + phone as peers.
2. Mac: add the VPS as a peer; bind the engine's remote listener to the WireGuard interface IP
   (the same mechanism as the plain tailnet bind — `enableRemote(<wg-ip>)`).
3. Phone: add the VPS as a peer; reach the engine at the Mac's WireGuard IP.
4. Set `PersistentKeepalive = 25` on the phone/Mac peers so NAT mappings stay open (the classic
   "works for 2 min then dies" gotcha).

This keeps the VPS as a dumb encrypted-packet forwarder — it sees only WireGuard ciphertext.

## Recipe B — TCP relay (rathole / frp)

If you want the phone to hit a public `host:port` without WireGuard on the phone: run `rathole` (or
`frp`) on the VPS, and a client on the Mac that dials out and registers the engine port. The phone
connects to the VPS, which tunnels to the Mac.

- The VPS sees **TCP bytes**. Before Phase 3 those bytes are your TLS/WS stream (the VPS can MITM if
  it terminates TLS — **don't let it**; keep it L4 passthrough). After Phase 3 they're double-wrapped
  (your AEAD session inside TLS) and the VPS learns nothing.
- The engine's pairing token is the only auth on the wire — keep it **off the query string** (already
  enforced, Phase 0.2) so a relay/proxy log never captures it.

## If a managed relay is ever offered (it is not, at launch)

`oss-at-scale-strategy.md` §4: a relay-we-run is a higher-value C2 target than a generic tunnel and a
free tier is brutal to sunset. If one is ever built it is gated behind three non-negotiables:

1. **Ciphertext-only by construction** — Phase 3 E2E must ship first, so the relay _cannot_ read or
   inject keystrokes even if compromised.
2. **Fair-queue / rate-limit / overload protection** from day one.
3. **A funding model that exists before launch** (no "free relay we later kill").

Until all three hold, the answer is this recipe — you run it.
