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
- 🔨 **Phase 4** land the work (pr-review-toolkit → push → draft PR; founder merges) — next.
