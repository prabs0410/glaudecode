# GlaudeCode — V5 Goal: Phone-Driven Full Terminal (open-source, secure-by-default)

> A standalone autonomous-build target, run like `docs/GOAL.md` / `docs/GOAL-V4.md`
> (`/goal @docs/GOAL-V5.md`). Inherits the north-star + guardrails from `docs/GOAL.md`; the
> load-bearing ones are restated below. **Every item is Implement → Verify → Review.** The design is
> already researched — each phase references the source-of-truth design doc; do not re-research, build
> against the doc.

---

## North-Star (this phase)

**Make GlaudeCode the open-source terminal you drive from your phone: your whole machine + Claude Code,
remoted to your pocket, over a transport you own, secure by default — no cloud we run, not even
Anthropic's.**

The differentiation is settled (see [[project-oss-full-terminal-from-phone]] / `docs/design/`):
competitors mirror the Claude *conversation*; GlaudeCode mirrors the **whole terminal** (run anything,
many sessions). The wedge is out-execution on **depth + trust + secure-by-default**, not first-mover.

**The hard constraint:** this ships a remote shell = remote code execution. At scale the *defaults*
define fleet-wide risk. Secure-by-default is mandatory, not optional. Remote *input* never ships before
its security work does.

**Design sources of truth (read before building each phase):**
- `docs/design/mobile-terminal-control.md` — feasibility + the mirror architecture
- `docs/design/secure-mirror-tech-stack.md` — the recommended libraries (SPAKE2 + Noise/AEAD, xterm.js, custom binary WS)
- `docs/design/transport-options-phone-to-mac.md` — transport (Tailscale Serve default; self-host options)
- `docs/design/oss-at-scale-strategy.md` — secure-by-default requirements, governance, positioning
- `docs/design/epic-g-remote-threat-model.md` — the remote threat model

---

## Build order: 0 → 7. Each phase is one or more `feat/v5-*` branches. Don't start a phase until the prior is committed + green.

### Phase 0 — Close the live security footguns (fast, gates everything public)
From `oss-at-scale-strategy.md` §2. These exist in current code and must be fixed before any remote use grows.
- **0.1** `remote.enable(host)` rejects wildcards (`0.0.0.0`/`::`/non-loopback) unless an explicit interface + (later) app-layer E2E is active (`server.ts:72-81`).
- **0.2** Move the WS token off the query string (`/ws?token=`) → first-message auth or a short-lived single-use WS ticket; **stop accepting the local bearer token on `/ws`** (`server.ts:130-131`, `cockpit.ts:144`).
- **0.3** Rate-limit + lockout + audit on `/pair` (unauthenticated + unthrottled today, `server.ts:120`); widen code entropy; baseline = code-server's 2/min + 12/hr.
- *Verify:* engine tests for the rate-limiter + WS-auth path; build green. *Review:* security-review of the three fixes.

### Phase 1 — View-only terminal mirror (APPROVED design — the de-risking slice)
See the approved design below (§"Phase 1 detail"). See your live GlaudeCode pane on your phone, read-only, over existing Tailscale + view-scope pairing. No remote input, no new crypto, no new trust boundary.
- *Verify:* engine unit tests for `PaneHub` ring-buffer (replay/eviction), the binary-protocol encode/decode, and the flow-control state machine; `bun test` green; `tsc` + `vite build` + `cargo check` clean; manual: open a pane → see it live on phone with scrollback; a big output burst doesn't corrupt or stall the local terminal. *Review:* pr-review-toolkit.

### Phase 2 — Remote input + `terminal` scope + per-pane arming (the RCE-class work)
From `mobile-terminal-control.md` §6 / `oss-at-scale-strategy.md` R6.
- **2.1** Dedicated `terminal` scope, **never implied by `steer`** (extend `TokenScope`, `requireScope`, `levelSatisfies`); add `pty:write`/arming methods to `LOCAL_ONLY_METHODS`.
- **2.2** Per-pane "allow remote input" arming on the desktop, **default OFF**; a terminal token can only write to armed panes.
- **2.3** Enforce the `terminal` scope **on every inbound keystroke frame at the WS message handler** *and* at the `/ws` upgrade (defense in depth).
- **2.4** Route cockpit keystrokes → `pty_write_internal`; resize negotiation (decision: desktop-authoritative-while-focused + explicit "take control").
- **2.5** Audit log + live desktop echo ("phone is driving pane X") + one-action kill-switch; short-TTL (≤1h) terminal tokens with idle-revoke.
- *Verify:* engine tests for scope enforcement (paired token denied `pty:write`; armed-pane gating); build green. *Review:* **security-review (mandatory)** — this is the RCE escalation.

### Phase 3 — App-layer end-to-end encryption (the public-release prerequisite)
From `secure-mirror-tech-stack.md`. Wrap the engine↔phone stream so the transport never sees plaintext.
- **3.1** SPAKE2 pairing (RustCrypto `spake2`, Ed25519 asymmetric mode) — the pair code becomes the PAKE password, not a cleartext bearer.
- **3.2** AEAD session (ChaCha20-Poly1305), ideally inside a Noise handshake (`snow` on Rust; WebCrypto on the browser — verify mobile X25519 support, else libsodium WASM). **Never unauthenticated AES-CTR (sshx's mistake).**
- *Verify:* engine/Rust unit tests for the handshake + AEAD round-trip + tamper-detection; build green. *Review:* **independent crypto/security review of the exact pairing+AEAD path is a release gate** (libs are unaudited) — this discharges the owed Epic G threat-model.

### Phase 4 — Mobile input UX
From `mobile-terminal-control.md` §5.
- Real xterm.js terminal route on the phone; **Mode A** message box (text + Enter, bracketed-paste); **Mode B** on-screen key bar (Esc/Tab/Shift-Tab/arrows/sticky-Ctrl, pinned via VisualViewport); **Mode C** semantic layer (tappable AskUserQuestion options, mode pills, snippets); multi-session attach/detach + switcher.
- *Verify:* component/tsc + build; manual on real iOS/Android. *Review:* pr-review + a real-device QA pass.

### Phase 5 — Transport & onboarding
From `transport-options-phone-to-mac.md` + `oss-at-scale-strategy.md` §3.
- Tailscale **Serve** as the blessed default (real TLS on MagicDNS → installable PWA + `wss`); keep the plain tailnet bind as zero-config fallback; **self-host relay recipe** (not a managed relay we run); tailnet ACL hardening guidance; QR pairing onboarding ("Connect my phone", never "configure Tailscale"); **keep-awake** (caffeinate / systemd-inhibit) while remote is enabled.
- *Verify:* docs + the bind/serve path; *Review:* pr-review.

### Phase 6 — Multi-OS
From `oss-at-scale-strategy.md` §6. **macOS + Linux Tier 1, Windows experimental (WSL recommended).**
- Linux: bash + fish OSC 133/7 integration (today zsh-only, `lib.rs:177-184`); fix the `$SHELL`→`/bin/bash` fallback for non-mac; WebKitGTK QA. Windows: PowerShell OSC, fix shell fallback, `.exe`/Program Files Tailscale discovery, hook-format test — labeled experimental.
- *Verify:* per-OS smoke + build; *Review:* per-OS shell-wrapper + transport-discovery review (parity is a security issue, not just a feature one).

### Phase 7 — OSS launch governance gate (blocking before public release)
From `oss-at-scale-strategy.md` §7.
- `SECURITY.md` (private reporting/GHSA, PGP, coordinated disclosure, safe-harbor); promote the threat model to public `docs/security/threat-model.md`; **secure-defaults CI gate** (default bind 127.0.0.1 tested; an unclassified `RpcMethod` **fails the build**; `terminal` scope separate/per-pane/non-pairing; `/pair` rate-limit shipped; wildcard-bind rejected; WS not query-string-authed); **signed releases + verified auto-updater (P0 — a tricked updater = mass RCE)**; first-run "remote shell is RCE" explainer + consent.
- *Verify:* CI gate passes; *Review:* full pre-launch security checklist + (post-adoption) third-party audit.

---

## Phase 1 detail — view-only terminal mirror (the approved design)

**Scope.** Read-only mirror of an in-GlaudeCode pane to the phone. **Out:** remote input, app-layer crypto, the `terminal` scope (Phases 2-3). Rides the existing view-scope pairing + remote bind; Tier-A-safe over Tailscale.

**Data flow** (the desktop path is untouched; the mirror is an additive tee in the reader's `Ok(n)` arm):
```
PTY child ─► Rust reader (lib.rs:218-237) ─┬─► app.emit("pty-output:{paneId}") ─► desktop xterm  (UNCHANGED)
                                           └─► pane-bridge WS ─► engine PaneHub ─► /term-ws ─► phone xterm
```

**Components:**
1. **Rust `pane_bridge.rs`** — a `tokio-tungstenite` WS *client* dialing the engine (localhost, engine-bearer authed); streams each pane's bytes tagged by `paneId`; reconnects on engine restart. Keep the PTY in Rust (don't move to Bun — preserves the zsh/OSC/`GLAUDECODE_MANAGED` logic). Refactor `pty_resize` into a reusable internal fn for the size-info frame.
2. **Engine `paneHub.ts`** (unit-tested) — receives pane streams from the bridge; bounded **per-pane ring buffer (~256 KB)** for replay-on-attach; fans out to cockpit subscribers over a **new binary `/term-ws`** (separate from the JSON approvals `/ws`); a `listPanes` **view-scope** RPC.
3. **Cockpit `/app/term`** — an xterm.js instance; attach to a pane → replay buffer then live bytes; capability-gated so the existing approvals cockpit is untouched.

**Wire protocol** (custom binary, *not* xterm `AttachAddon`): 1-byte opcodes — `0x00` output (server→client), `0x01` pty-size-info (server→client; phone renders at the desktop pane size, never changes it this slice), `0x02` ACK (client→server, byte count consumed, for flow control).

**Error handling:** ACK-paced flow control (pause forwarding to a slow subscriber past a watermark; the local terminal NEVER stalls — non-blocking tee, drop-oldest into the ring); reconnect → replay then live; pane close → close frame → "session ended"; engine/desktop restart → bridge reconnects, subscribers re-attach.

**Security boundary:** the pane-bridge (Rust↔engine) is **localhost + engine-bearer only** (test: a paired token gets 401 on `/pane-bridge`); `/term-ws` is **view-only** — no input path exists in this slice, so no RCE surface and no `terminal` scope needed; gated by the existing view-scope pairing token.

**Definition of done:** open a pane on the desktop → see it live on the phone with scrollback-on-attach → big bursts don't corrupt or stall the local terminal → engine tests green + Rust/desktop build clean.

---

## Guardrails (inherited from `docs/GOAL.md` — load-bearing, restated)
1. **Branch + PR only.** Never commit to `main`. Each phase → `feat/v5-*` branch(es).
2. **Tests + build gate.** No item is done unless `bun test` (engine), `tsc`/`vite build` (desktop), `cargo check` (Rust) pass.
3. **Never destructive.** No force-push / `main` rewrite / deleting user data. Commits MUST stay **`prabs0410`**; no AI co-author lines. (PRs blocked until `gh auth login` as prabs0410 — push is fine via the `github-personal` SSH alias.)
4. **Adapter rule (Principle XI).** All Claude Code access via `ClaudeCodeAdapter` + SDK; no raw JSONL; no tight polling.
5. **One phase at a time, in order (0→7).** Don't start the next until the current is committed + green.
6. **Stop on repeated failure.** After 2 consecutive failed attempts on an item, STOP and leave a note.
7. **Secure-by-default is a release gate** (Phase 7 CI gate). Remote *input* (Phase 2+) never merges before its security review; the crypto path (Phase 3) needs an independent review before public release.
8. **Keep docs honest (Principle IX).** Update `docs/INDEX.md` / `docs/state.md` as relevant — but the **founder curates top-level docs** ([[feedback-founder-curates-top-level-docs]]); flag, don't edit GOAL/INDEX/state/AGENTS; put agent work in NEW files.
9. **Felt-improvement + no-namesake filter (Principle II).** Every surface must be genuinely functional, not decorative.

### The one human knob
- **Auto-merge to `main`:** OFF (PRs stay open for human approval).
- **Open founder decisions** (from the research, surface before the relevant phase): resize authority (Phase 2), Windows tier label (Phase 6), whether an optional managed relay ever ships (post-launch, gated).
