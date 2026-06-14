# Secure phone↔Mac terminal-mirror — recommended tech stack (deep-research)

> Status: cited technical-evaluation input for the mirror design. Produced by the deep-research harness
> (5 angles, 24 sources fetched, 114 claims extracted, top 25 adversarially verified 3-vote → 24
> confirmed, 1 killed). Every recommendation below traces to a primary source. Companion to
> [`mobile-terminal-control.md`](mobile-terminal-control.md) (feasibility) and
> [`transport-options-phone-to-mac.md`](transport-options-phone-to-mac.md) (transport).
> **Headline caveat: the recommended crypto libraries are all self-declared unaudited/beta — an
> independent security review of the final pairing+AEAD path is mandatory before the remote cockpit
> ships (this also discharges the owed Epic G threat-model).**

## Recommended stack (by layer)

| Layer | Recommendation | Runner-up | Why |
|---|---|---|---|
| **Pairing (short code → shared key)** | **SPAKE2 PAKE** (Magic-Wormhole model) | SPAKE2+ / OPAQUE (open Q) | A one-time low-entropy code gives an online attacker (incl. a malicious relay) **a single guess**; payload sealed with a key derived from the PAKE so the transport never sees plaintext. Exactly our short-code model. |
| **PAKE impl (Rust core)** | **RustCrypto `spake2` crate**, Ed25519Group | — | Pure-Rust, Apache-2.0/MIT, interoperable with Brian Warner's python-spake2 (= Magic Wormhole) for cross-language Rust↔Bun↔browser. **Unaudited (self-declared).** Use asymmetric (start_A/start_B) mode, not symmetric. |
| **Session encryption** | **AEAD — ChaCha20-Poly1305** (or AES-GCM), ideally inside a **Noise handshake** | libsodium secretbox (XSalsa20-Poly1305) | **NEVER unauthenticated AES-CTR** — that's sshx's mistake (AES-128-CTR, no MAC, hardcoded public salt → ciphertext malleable, tamper undetectable). AEAD's tag detects a single flipped bit. |
| **Noise impl (Rust)** | **`snow`** (Noise spec rev 34; X25519 + ChaChaPoly/AES-GCM) | hand-rolled X25519 + AEAD over `ring`/libsodium | "Hard to fuck up," tracks latest spec. **Not formally audited** — can use ring/HACL* backends for primitives, but that doesn't audit the state machine. |
| **Noise/crypto impl (browser+Bun)** | **Native WebCrypto** (X25519 + ChaCha20-Poly1305/AES-GCM) preferred | `emilbayes/noise-protocol` (libsodium WASM, **BETA**, ~69★) | WebCrypto avoids a WASM/JS crypto dependency and is more auditable — *but* confirm X25519 support on target iOS Safari / Android Chrome (landed recently, varies). |
| **Terminal renderer (phone)** | **xterm.js** (already our choice) | — | De-facto: ttyd, VS Code, Tabby, Hyper. Confirms the existing React/xterm.js cockpit choice. |
| **Mirror wire protocol** | **Custom binary WebSocket** — ttyd-style 1-byte opcodes (output / input / resize) + **app-layer ACK flow control** + **replay-on-attach ring buffer** | — | **Do NOT use xterm.js `AttachAddon`** — no resize, no scrollback/replay. And xterm.js `write()` is non-blocking with a hardcoded **50MB buffer that discards overflow**; WS buffers are effectively infinite → you MUST ACK-pace the producer (pause the PTY when the phone falls behind). |
| **Rust↔engine PTY bridge** | **OPEN** — `tokio-tungstenite` WS client in Rust **vs** move PTYs into Bun v1.3.5 (native PTY) | tauri-plugin-pty / tauri-terminal (refs) | Not verified by the research; decide in design. Prior analysis leaned toward keeping the PTY in Rust + a `tokio-tungstenite` bridge (avoids re-porting the zsh/OSC/GLAUDECODE_MANAGED logic). |
| **Connectivity (if beyond BYO-Tailscale)** | **Stay transport-agnostic** (bring-your-own) | boringtun (WireGuard) / webrtc-rs+TURN / libp2p | Not verified; likely out of scope given the "no hosted tunnel tier" stance. |
| **Mobile input UX** | xterm.js + on-screen modifier/arrow key-bar; PWA needs a secure context (TLS) | — | (Detail in the feasibility doc §5.) |

## The two hard rules (verified, load-bearing)

1. **AEAD, never raw AES-CTR.** sshx shipped AES-128-CTR with no integrity → an attacker who knows/guesses plaintext can flip ciphertext bits undetected. For an interactive shell this is disqualifying. Use an authenticated cipher (ChaCha20-Poly1305 / AES-GCM), and key it from the PAKE — not from a stretched low-entropy key with a public salt.
2. **App-layer ACK flow control, not buffers.** xterm.js silently discards past 50MB; WebSocket buffers are unbounded. Without an ACK-paced protocol a `cat bigfile` on a slow phone link overruns and corrupts the view. The local terminal must never stall because a phone is attached (non-blocking tee, drop-oldest).

## Open questions the research explicitly did NOT settle (resolve in design)

- **SPAKE2 vs SPAKE2+ / OPAQUE** — only plain SPAKE2 (Magic Wormhole) was verified. For a pairing handshake (no password stored at rest) plain SPAKE2 is likely fine, but confirm.
- **Exact Noise pattern** — a PSK-augmented pattern (e.g. `NNpsk0` / `XXpsk0`) seeded from the SPAKE2 secret is the natural fit, but the handshake composition was not verified.
- **Rust↔Bun PTY bridge** — `tokio-tungstenite` vs Bun-native-PTY; not verified.
- **Browser WebCrypto X25519 on mobile** — support varies by iOS/Android version; verify on targets before committing to WebCrypto-over-WASM.
- **App-managed connectivity** — WebRTC/boringtun/libp2p; likely out of scope (BYO transport).

## Caveat (repeat, because it's the gate)

`spake2`, `snow`, and `emilbayes/noise-protocol` are all self-declared **unaudited / beta**. The protocol *choice* is sound (it mirrors Magic Wormhole, a well-regarded design), but the *implementations* need an independent crypto review of the exact pairing+AEAD path before the remote cockpit ships. One verifier also refuted the claim that snow's default resolver covers the full primitive set incl. BLAKE3 — confirm the exact DH/AEAD/hash set against the chosen resolver + feature flags.

## Primary sources
Magic Wormhole docs · RustCrypto/PAKEs (spake2) · warner/python-spake2 · ekzhang/sshx (+ HN #38152109) ·
mcginty/snow · emilbayes/noise-protocol · xterm.js flow-control guide + addon-attach · tsl0922/ttyd ·
bun v1.3.5 blog · snapview/tokio-tungstenite · cloudflare/boringtun · Tailscale Funnel docs.
