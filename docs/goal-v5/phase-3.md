# Phase 3 — App-layer end-to-end encryption  ·  me-first #3  ·  `feat/v5-crypto`

> Reading outline. **`README.md` is authoritative + what the loop runs** — see its Phase 3 section for full Files / Sub-tasks / Verify / Review per task.

Wrap the engine↔phone stream in an app-layer AEAD session: pair code → SPAKE2 PAKE password → Noise handshake → ChaCha20-Poly1305 sealing the existing auth/`/ws`/`/term-ws` frames. The bearer/`PairingService` model stays inside the tunnel. Hard rules: **AEAD only, never unauthenticated AES-CTR**; loopback bridges stay bearer-only/cleartext. Design: `docs/design/secure-mirror-tech-stack.md`.

- **Story 3.0 — Crypto foundations & library decision (de-risk first)**
  - 3.0.1 Verify mobile X25519/ChaCha20-Poly1305, pick the browser backend [🔨, device-gated] · [HUMAN-GATE (blocks 3.2): real-device probe] · [FOUNDER-DECISION: WebCrypto else libsodium-WASM]
  - 3.0.2 Pin the cipher-suite + Noise pattern across all 3 runtimes [⚡] · [FOUNDER-DECISION: NNpsk0 seeded by SPAKE2 PSK]
- **Story 3.1 — SPAKE2 pairing (code = PAKE password; Magic-Wormhole-interop)**
  - 3.1.1 SPAKE2 (Ed25519 asymmetric) in the Rust core [🏗]
  - 3.1.2 SPAKE2 in the engine/browser runtime (cross-language) [🏗]
- **Story 3.2 — Noise + ChaCha20-Poly1305 session: seal the frames**
  - 3.2.1 Noise handshake seeded by the SPAKE2 secret (`snow` ↔ engine/browser) [🏗]
  - 3.2.2 Wrap the WS app-frames in the AEAD session [🏗]
  - 3.2.3 Gate non-loopback bind on an active E2E session [🔨] · (enforced by the Phase 7 gate)
- **Story 3.3 — Phase-2 deferred hardenings (belong with crypto)**
  - 3.3.1 Fail-closed on the input-bridge reconnect [🔨]
  - 3.3.2 Lifecycle audit logging of remote-input events [🔨]
  - 3.3.3 Short-lived rotating `terminal` tokens — ≤1h + silent refresh (design R8) [🔨]
- **Story 3.4 — Cross-stack integration proof**
  - 3.4.1 End-to-end encrypted-mirror test (Rust↔engine↔browser) [🏗]
- **Story 3.5 — Independent crypto/security review (release-blocking for PUBLIC)**
  - 3.5.1 Assemble the review packet + obtain the independent review [⚡] · [HUMAN-GATE (release-blocking): independent crypto review]
