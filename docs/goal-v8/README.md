# GlaudeCode V8 — Away-mode push · token durability · security groundwork · landing

> **RUN MODE.** Work top-to-bottom, one task at a time, TDD where it fits. After EVERY task: run
> `bun run verify`, then commit (attributed to `prabs0410`) on `feat/v6-conversation`, and update the
> Progress log. Founder-gated *activation* steps are flagged — build + unit-test behind them, never block.

## Context

The V7 loop finished all autonomous work (HEAD `60c34f4`, verify green: engine 461 · desktop 9). These
four items each needed a founder decision, now settled. The thesis is a private, lid-closed, voice-first
Claude Code cockpit on your own Mac + Tailscale — its biggest missing piece is **push** (the phone is
pull-only today). Full design + rationale: the approved plan (`~/.claude/plans/resilient-singing-jellyfish.md`).

## Locked decisions

- **C1 → HMAC signing key** (one secret + a persisted revocation list at rest; tokens self-verify, survive respawn).
- **Landing → push + prep PR; founder merges** (git push works via the SSH alias; only `gh` PR/merge needs the login).
- **Push crypto → hand-rolled `node:crypto`** (VAPID ES256 + RFC 8291 aes128gcm); `web-push` is the isolated fallback.
- **Sequence → Phase 1 Push → 2 C1 → 3 WS4 doc → 4 Land.**
- **WS4 = threat-model doc only**; seamless-pairing implementation is a separate goal pending go/no-go.

## Founder-gated activation (flagged, not build blockers)

- **Enable Tailscale Serve / MagicDNS+HTTPS** → activates + device-tests push.
- **`gh` login as `prabs0410`** (or web UI) → create the PR + merge to main (Phase 4).
- **WS4 go/no-go** → whether seamless pairing gets built.

## Phases (see the plan for file-by-file detail)

- **Phase 1 — Push delivery:** `push.ts` sender (hand-rolled VAPID JWT + aes128gcm + `PushSender` with prune/no-crash/metadata-only) · server trigger (`maybePush` debounce + `ApprovalQueue.onEnqueue` + a pure transition detector on the existing 2s broadcast for question/finished/error) · `SW_JS` + `/app/sw.js` · `conversationPage` `subscribePush()` + "🔔 Enable alerts" gesture · committed PNG icons · tests. Real delivery is device-gated on HTTPS.
- **Phase 2 — C1 HMAC tokens:** `tokenSigning.ts` (persisted signing key 0600, `signToken`/`verifyToken`) · persisted `RevokedStore` · wire `PairingService` redeem/verify/revoke + server self-persist the key. Tokens + revocation survive respawn. No Rust change.
- **Phase 3 — WS4:** `docs/design/seamless-pairing-threat-model.md` (assets/adversaries, how the Phase-2 token model changes the calculus, device-bound tokens, safety nets, go/no-go). Doc only.
- **Phase 4 — Land:** pr-review-toolkit → fix → `git push origin feat/v6-conversation` → draft the PR body into a `docs/` file. Founder does the final auth + merge.

## Progress log

- ✅ **Phase 1.1** `push.ts` sender — hand-rolled VAPID ES256 JWT (`vapidAuthHeader`) + RFC 8291 `aes128gcm` (`encryptPayload`: ECDH→HKDF→AES-128-GCM) + `buildPushRequest` + `PushSender.deliver` (fan-out, prune dead subs on 404/410, never-throws, metadata-only payload). 9 tests — the key one **decrypts the body end-to-end** to prove the crypto chain; plus VAPID JWT verifies against the public key, prune-on-410, no-crash-on-network-error, zero-sub fast path. No new deps (`node:crypto`). 470 engine tests.
- ✅ **Phase 1.2** server-side trigger — `maybePush` (gated on `wouldDeliverPush` + per-`session:kind` 60s debounce; no-op until a phone subscribes; metadata-only) wired to **approval** via a new queue-level `ApprovalQueue.onEnqueue` subscriber (the production `/approval` path calls `submit()` without opts, so per-call hooks would miss it). The pure edge-detector `pushTrigger.ts` (`detectPushKinds`: question on→waiting, finished on→idle, error on new error tool_result; never on first sight) is built + table-tested. `StartOptions.pushSend` injects a fake transport so the fan-out is tested without a network. 479 engine tests (+9).
  - 🚩 **Deferred (flagged):** wiring the detector for **question/finished/error** into the 2s broadcast needs server-side session enumeration (which project dir(s)/sessions to sample) — panes carry no session dir today, so that's a follow-up. **Approval** (the most important "Claude is blocked" push) is fully wired now.
- ✅ **Phase 1.3** service worker — `SW_JS` in `cockpit.ts` (a push RECEIVER: `push` → `showNotification`, `notificationclick` → focus/open `/app/chat?pane=…`; offline caching omitted in v1) served standalone at `GET /app/sw.js` (`text/javascript`, `Service-Worker-Allowed: /app`); registered in the cockpit bootstrap gated on a secure context (`location.protocol==='https:'`). Parse-guard test (parses, has both handlers, no `</script>`) + route + registration tests. 482 engine tests (+3). (The conversation-page registration pairs with the subscribe flow in 1.4.)
- ✅ **Phase 1.4** front-end subscribe — a 🔔 bell button in the conversation-page bar (hidden unless push is possible: secure context + `PushManager` + steer+) registers the SW and, on an **explicit tap** (iOS needs a gesture — never auto-prompts), does `Notification.requestPermission()` → `GET /push-key` → `PushManager.subscribe(applicationServerKey)` → `POST /push-subscribe` (Bearer token, never a query token); re-subscribe is idempotent, auto-resubscribes if already granted. Parse-guard stays green + new assertions (secure-context/steer gating, Bearer not query, explicit-tap-only). 485 engine tests (+3).
- ✅ **Phase 1.5** PNG icons — a **pure-node** generator `scripts/gen-icons.ts` (zlib + hand-rolled PNG chunks + CRC32, **no native dep**) renders the "G" mark to committed PNGs (192 / 512 / 512-maskable in `vendor/`); `readVendorBytes` + `GET /app/icon-*.png` routes (image/png, 503 if missing); manifest rewritten to the PNGs (`any` + `maskable`), SVG data-URI removed. The SW's notification icon now resolves. Tests: routes serve valid PNGs of the right dimensions + the manifest references them. 488 engine tests (+3).

### ✅ Phase 1 COMPLETE — push delivery is built end-to-end (sender · approval trigger · service worker · subscribe · icons). Only **real device delivery** remains, gated on you enabling **Tailscale Serve / HTTPS** (then: open the chat on the phone → 🔔 Enable alerts → background it → an approval on the Mac buzzes the phone).

- ✅ **Phase 2 (C1)** HMAC token persistence — paired phones now **survive an engine respawn** instead of being logged out. Tokens became HMAC-signed capabilities (`tokenSigning.ts`: `sign(deviceId.scope, key)`); the authoritative scope/expiry/revocation live in a **persisted device roster** (`deviceStore.ts`) — presence = valid, absence = revoked. `pairing.ts` refactored off the in-memory tokens Map onto signed-token verify + roster (throttled persist so a terminal token's ~2s refresh doesn't hammer disk). Server self-persists the **signing key** (`~/.glaudecode/token-key`, 0600) + the roster (`devices.json`, 0600) under `configHome`. **No token at rest** (only the key + device metadata persist; the bearer token lives on the phone). **No Rust change** (the engine bearer token + handshake are untouched). New tests: tokenSigning (sign/verify, tamper/forgery/expiry rejected, key persistence) + pairingPersistence (token survives respawn, revoke survives respawn, forgery rejected, pre-C1 ephemeral fallback). All existing pairing/rpc/secureDefaults stay green; `server`/`upload` tests now inject a temp `configHome` for isolation. 499 engine tests (+11). *(Token format changed → any pre-existing paired device re-pairs once.)*
- ✅ **Phase 3 (WS4)** seamless-pairing threat-model — `docs/design/seamless-pairing-threat-model.md`: the precise proposed change (terminal-from-QR + 30-day + auto-arm), the risk delta (one scan = persistent pre-armed RCE), the threats (lost/stolen phone, shared tailnet, token theft/replay, QR interception), how C1's HMAC + **durable revocation** already met one precondition, the **device-bound token** design as the remaining linchpin, the safety nets that must stay (Rust arming gate + kill-switch + durable revoke + audit), and a **staged conditional-GO** recommendation (do the no-risk UX now; hold the 30-day TTL + auto-arm until tokens are device-bound + the tailnet ACL is pinned). Doc only — implementation gated on the founder's go/no-go. Listed in the docs-drift note for INDEX. *(No code; gate unaffected.)*
- ✅ **Phase 4** land the work — ran `pr-review-toolkit` (code-reviewer + silent-failure-hunter) over the V8 diff: **crypto + token refactor found sound** (round-trip decrypt + JWT-verify tests validate the hand-rolled crypto; the signed-token/roster model is strictly stronger than before). Remediated the flagged **silent-failure** gaps (`aee8bdd`): the "Alerts on" false-positive (now checks `r.ok` + surfaces failures), per-target push `onFailed` observability (warn-level), corrupt key/roster/subscription resets now logged, SW blank-notification fallback, + two tests' `configHome` isolation. Drafted the PR body (`docs/handoffs/2026-06-20-v7-v8-pr-draft.md`) and **pushed `feat/v6-conversation` to origin**. **PR creation + merge are founder-gated** (gh is `ashinclude`) — flagged, not done.

### ✅ V8 COMPLETE — every non-gated, non-blocked task done.

**Shipped (all committed on `feat/v6-conversation`, `bun run verify` green — engine 500 · desktop 9):** Phase 1 push delivery (sender · approval trigger · service worker · subscribe · icons), Phase 2 C1 HMAC token persistence, Phase 3 WS4 threat-model, Phase 4 review-remediation + push + PR draft.

**Founder-gated (NOT loop work):** enable Tailscale Serve/HTTPS (activates real push delivery + device test) · `gh` auth as `prabs0410` (create PR + merge to main) · WS4 go/no-go (build seamless pairing) · device-bound tokens (the linchpin for a 30-day terminal token) · the deferred question/finished/error detector wiring (needs server-side session enumeration) · the D11/#22 + D12 doc edits from V7.

---

### 🟡 Post-V8 — conversation-page UX (live-tested), IN PROGRESS

The founder tried to *use* the mobile chat page and it was "all there but not usable." V8 had shipped
green on unit tests but its **lived UX was never validated**. Fixed (commit `b5d3c77`, each verified by
driving the real page in Chrome at a phone viewport — see `docs/handoffs/2026-06-20-conversation-ux-fixes-and-test-rig.md`
+ memory `feedback-test-the-lived-ux`):
- ✅ **Layout overlap** (the "input not visible" root cause) — chat/composer were absolutely+fixed
  positioned and overlapped; rebuilt as a flex column + `100dvh` (keyboard-aware). Input now visible.
- ✅ **Puck draggable** — was impossible by design (needed a 260ms pause); a deliberate drag now moves it,
  a quick flick still fires an arrow.
- ✅ **Collapsible shortcut bar** — added the "⌄ shortcuts" chevron (persisted) + a subtler idle puck.
- 🔨 **NOT DONE — the founder has more UX feedback coming.** This is a start, not the finished UX. Known
  rough edges to revisit: the puck's 4 overloaded gestures; steer scope has no composer; general polish.
  Next step = a real usability pass using the test rig (drive → find cause → fix → re-verify live).
