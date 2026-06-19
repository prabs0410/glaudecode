# GlaudeCode — Risks: Security, Reliability & Performance

> Produced by a multi-agent review (security, observability/reliability, and performance passes) on 2026-06-19.

This document is candid. Severities are not inflated, but the items at the top are genuinely the ones to resolve before the V6 phone-cockpit pivot widens its blast radius. Each item states **why it matters**, a **concrete direction**, and a **rough effort** (S / M / L / XL).

---

## 1. Security — lead risks

### 1.1 Planned relaxed pairing (WS4) collapses the entire kill-chain — HIGH
**File:** `packages/engine/src/pairing.ts` (refresh design at `pairing.ts:166-181`)

The current model is safe largely because compromise requires a *conjunction* of conditions: steal code within ~2 minutes **and** obtain terminal scope **and** wait for the user to arm a pane **and** the token is still < 1h old **and** the socket stays continuously live. The planned WS4 (terminal scope straight from the QR + a 30-day token + auto-arm) removes every one of those layers at once. It reduces the attacker requirement to *"possess one QR or token, once."*

**Why it matters:** A photographed or screen-shared QR, or a bearer token copied out of phone `sessionStorage`, becomes a **30-day, always-armed remote shell on the founder's Mac** — with no human in the loop. The `refresh()` design that bounds a leaked token's lifetime (`pairing.ts:166-181`) is meaningless at a 30-day TTL, and auto-arm deletes exactly the human-in-the-loop step that the 2026-06-15 audit called "the single most important fix."

**Direction (do NOT ship terminal-from-QR + 30-day + auto-arm together):**
- Write a threat-model delta specifically for WS4 *before* building it.
- Make terminal tokens **device-bound**: bind to a phone-held keypair, not a bearer string in `sessionStorage`, so a copied token is useless off-device.
- Make auto-arm **opt-in per pane**, with a persistent visible indicator and an idle auto-disarm.
- Require the long-lived token to be **re-attested** (biometric / keypair challenge) before each session, rather than trusting a 30-day bearer.

**Effort:** L

### 1.2 `/upload` buffers the whole body before the size cap — LOW
**File:** `packages/engine/src/server.ts:533` (`await request.arrayBuffer()`) then length check at `server.ts:535`

The early `413` only fires on a declared `content-length` (`server.ts:532`). A chunked request with no `content-length` skips that check, and the code then does `await request.arrayBuffer()` — buffering the *entire* body into memory — before checking `bytes.length > cap` at `server.ts:535`. The real cap is post-allocation.

**Why it matters:** A device already holding the highest-trust terminal-scope token can POST a multi-gigabyte chunked body; repeated concurrent uploads spike the Bun sidecar's memory well past the intended 25 MiB cap and can OOM-kill the founder's only remote terminal link. Severity is LOW because that token *already* permits killing the session via the PTY — it grants no new capability, only a cheaper denial-of-service.

**Direction:** Stream the body with a running byte counter and abort/respond `413` the moment cumulative bytes exceed `cap` (read at most `cap+1` bytes), instead of `arrayBuffer()`-then-check. Bun supports reading the body as a stream.

**Effort:** S

---

## 2. Observability & reliability — lead risks

For a founder whose stated north star is *"silent failure is the enemy,"* these are the gaps where the product's own premise (a private, lid-closed, voice-first phone cockpit) is least observable.

### 2.1 Phone surfaces have no error pipe back to the Mac — HIGH
**Files:** `packages/engine/src/server.ts:453-460`, `conversationPage.ts:504`, `termPage.ts`, `packages/desktop/src/main.tsx:10-63`

The diagnostics pipe that forwards uncaught errors to the engine is bearer-gated to the **desktop only**. The phone — the surface that matters most in this pivot — has no way to report a failure off-device. A blank conversation page or a crashed puck handler is invisible unless the founder happens to be looking at the phone and taps the status chip.

**Why it matters:** A phone-side JS error or blank render produces **zero signal** on the lid-closed Mac. The primary, voice-first surface can silently fail with no diagnostic trail — the exact failure mode the product is built to eliminate.

**Direction:** Add a paired-token-authed `POST /clientlog-remote` (or extend `/clientlog` to accept any verified paired token at view scope), payload-capped and audit-logged. Have `conversationPage.ts` / `termPage.ts` POST their `window.error` + `unhandledrejection` into it, and surface forwarded phone errors in a Mac-side diagnostics view (see 2.4).

**Effort:** M

### 2.2 Incomplete global error capture — `unhandledrejection` and the terminal page are uncovered — HIGH
**Files:** `conversationPage.ts:504`, `termPage.ts`

The diagnostics HUD shipped specifically to fight silent failure has two holes: (1) `conversationPage.ts` only listens for `error`, not `unhandledrejection` — yet promise rejections from RPC are the *most common* failure class on that page; and (2) `termPage.ts` (the security-trusted fallback the founder switches to when the conversation view breaks) has **no global error handler and no HUD at all**.

**Why it matters:** The surface you fall back to *when something is already broken* is the one with zero failure visibility.

**Direction:** Add `window.addEventListener("unhandledrejection", ...)` to `conversationPage.ts` feeding `dbg.errs.js`. Port the `#dbg` HUD + both global handlers into `termPage.ts` so the fallback surface is at least as observable as the primary.

**Effort:** S

### 2.3 Engine sidecar stderr is `Stdio::inherit()` — production logs go to a void — HIGH
**Files:** `packages/desktop/src-tauri/src/lib.rs:586`, `lib.rs:710-724`; emitters at `server.ts:160,458,503,509,553`

In a Finder-launched packaged `.app` there is no TTY, so `Stdio::inherit()` discards **everything** the system emits: audit events, pairing brute-force signals, upload failures, engine crash/respawn lines, and the desktop's own forwarded WebView errors. The comment at `lib.rs:715` even assumes stderr is visible ("so a respawn is visible in tauri dev") — which is exactly the dev-only blind spot.

**Why it matters:** The founder running the real app lid-closed has **zero durable production diagnostics and no security trail**.

**Direction:** Pipe the engine's stderr (`Stdio::piped()`) and tee both the engine stream and Rust `eprintln!` output to a rotating log file under `~/Library/Logs/GlaudeCode/`. Add a "Reveal logs" menu item. This one change makes every existing `console.error` / `eprintln!` durable in production.

**Effort:** S

### 2.4 Audit log has no Mac-side UI — the RCE-channel trail is invisible — MEDIUM
**Files:** `rpc.ts:470-472`, `audit.ts`

The audit log exists precisely so remote RCE activity is accountable, but no UI was ever wired to read it. Combined with 2.3 (audit lines also discarded in production) and the in-memory ring being wiped on restart, there is effectively no way to review *"what did my phone type into my Mac"* after the fact.

**Why it matters:** After a phone is lost/revoked or types something unexpected, the trail needs a hand-crafted RPC to read and is gone on the next engine restart — no surfaced, durable post-incident record.

**Direction:** Add a "Remote activity" panel in the desktop (next to `RemoteArmedChips` / `PairingModal`) that polls `auditLog` and renders the recent trail with counts of input/arm/upload events. Persist the ring to the log file from 2.3 so it survives restarts.

**Effort:** M

### 2.5 Engine-down banner is desktop-only — the phone silently freezes — MEDIUM
**Files:** `packages/desktop/src/EngineStatusBanner.tsx:13-19`, `conversationPage.ts:172-173`, `termPage.ts:251,383`

On an engine crash + retry window (and especially after the supervisor gives up), the desktop shows a clear actionable banner ("restart GlaudeCode"), but the phone shows nothing distinguishable from a normal reconnect.

**Why it matters:** The lid-closed founder could voice-drive a permanently-dead session with no indication the backend gave up.

**Direction:** Have the phone pages detect repeated reconnect failures (N consecutive WS closes / `/health` failures) and show a distinct "Engine unreachable — your Mac may need attention" state instead of an infinite silent retry. Optionally expose engine liveness via a paired-token-readable status RPC so the phone mirrors the desktop's engine-down state.

**Effort:** M

---

## 3. Performance — steady-state churn

None of these are crashes or correctness bugs. They are continuous CPU/battery/bridge waste that scales with transcript length and connected-surface count — which matters precisely because the founder runs this always-on, lid-closed.

### 3.1 Every derived-state RPC re-reads and re-parses the full session; no cache — MEDIUM
**Files:** `rpc.ts:368-388`, `conversationPage.ts:295-299`, `adapter.ts:47-59`

The phone's `poll()` fires **three** RPCs every 2s — `getSessionMessages`, `agentState`, `promptState` (`conversationPage.ts:296-298`). Each of `agentState` / `promptState` / `timeline` / `sessionCost` / `sessionChanges` / `contextUsage` independently calls `adapter.getSessionMessages(...)` in its dispatch case (`rpc.ts:369,374,378,382,386,436`), which forwards to a full SDK read + `mappers.map` over every message (`adapter.ts:52-58`). There is **no memoization**, so one phone poll re-parses the entire session ~3×/2s; a desktop StatusBar poll adds 3 more.

**Why it matters:** On a multi-MB transcript this is megabytes of repeated JSONL parse + allocation per second, scaling linearly with transcript length *and* with the number of connected surfaces.

**Direction:** Add a short-TTL (1–2s) per-`(id, dir)` cache of the mapped `SessionMessage[]` in dispatch (or the adapter), so the reads in a poll window collapse to one parse. Better still: a combined `sessionSnapshot` RPC returning `{messages, agentState, promptState, cost, context}` so the phone makes **one** call instead of three.

**Effort:** S

### 3.2 Phone conversation page polls forever with no visibility gate — MEDIUM
**File:** `conversationPage.ts:295-299,507`

`setInterval(poll, 2000)` (`:507`) never pauses on `visibilitychange` / `document.hidden`. When the phone locks or the PWA backgrounds, it keeps firing 3 RPCs every 2s over Tailscale — each a full session read on the Mac (see 3.1) — for nothing visible. Notably the **terminal** surface *does* gate on visibility (`termPage.ts:584`), so the primary mobile surface is the one missing the guard — exactly the always-on-idle case the founder lives in.

**Why it matters:** A backgrounded/locked phone needlessly wakes its radio and the Mac's CPU continuously.

**Direction:** Skip `poll()` when `document.visibilityState === "hidden"` (or clear/restart the interval on `visibilitychange`), mirroring `termPage.ts:584`. Re-poll immediately on becoming visible so unlock shows fresh state.

**Effort:** S

### 3.3 `renderChat` rebuilds the entire chat DOM on any block change — MEDIUM
**File:** `conversationPage.ts:222-248`

The signature `msgs.map(m => m.id + ":" + m.blocks.length).join(",")` (`:224`) skips work only when identical (`:225`). But while Claude streams, the last message's block count changes every poll, so the signature changes, triggering `chat.textContent = ""` (`:228`) and a full re-create of every message/block node for the **whole** session (`:229-244`) — O(total-messages) teardown+rebuild every 2s for the entire duration Claude works.

**Why it matters:** On a long conversation this causes visible jank, layout thrash, and lost text selection on the phone.

**Direction:** Render incrementally — track the last-rendered `(messageId, blockIndex)` and append only new nodes; full rebuild only when an earlier message changes (rare). Or diff by message id and patch the last message's container instead of clearing `#chat`.

**Effort:** M

### 3.4 Many uncoordinated desktop pollers re-read the same session — MEDIUM
**Files:** `StatusBar.tsx:17`, `ConflictBanner.tsx:9`, `TimelinePanel.tsx:12`, `ChangesPanel.tsx:16`, `ApprovalPanel.tsx:15`, `NotificationService.tsx:11`, plus others

At least nine desktop components run their own `setInterval` pollers at 1.5/2/2.5/3/4/5/6/8s. Several hit session-derived RPCs with no shared cache: StatusBar (2s → 3 reads), TimelinePanel (2s → timeline), ChangesPanel (2.5s → sessionChanges), ConflictBanner (4s → `conflicts`, which reads `getSessionMessages` for *every* session via `Promise.all`, `rpc.ts:393-398`). Unphased timers periodically align and fire concurrent full-session reads. Combined with 3.1, a single selected session can be parsed ~8–10× per ~2s window across the desktop UI alone, before any phone.

**Why it matters:** Wasted CPU and SDK calls that compound with the conflicts poller's per-session fan-out.

**Direction:** A single shared session-snapshot poller / cache in the WebView (one fetch per session per interval feeding all panels via context), and/or the engine-side TTL cache from 3.1 so concurrent reads coalesce. Phase/jitter the intervals to avoid alignment spikes.

**Effort:** M

### 3.5 PaneHub ring buffer can under-trim, and resync replays the full ring per lagging sub — LOW
**File:** `packages/engine/src/paneHub.ts:82-103,156-162,205-213`

The ring trims with `while (p.ringBytes > this.ringMax && p.ring.length > 1) ...` — stopping at `ring.length > 1` means a single very large chunk is never evicted, so a burst (`cat largefile`, a noisy build) can hold a chunk far above the 128 KiB target. Separately, every resync (ACK-driven at `:135`, timer-driven `resyncStalled` at `:145-151` on the 2s sweep, `server.ts:607`) calls `replay()` which re-encodes and re-sends the **entire** ring (`:205-213`). A genuinely slow/lossy phone link keeps re-lagging and getting full-ring repaints every couple seconds — multiplying bridge throughput exactly when the link is already the bottleneck.

**Why it matters:** Extra bridge throughput when the link is the constraint, plus an occasional memory overrun of the ring target.

**Direction:** Split oversized incoming chunks before pushing so the byte cap always holds; on resync, cap/coalesce the replayed bytes (send only a screenful tail, or one coalesced buffer) rather than re-emitting the full ring to a chronically lagging subscriber.

**Effort:** M

---

## Priority ordering

1. **WS4 relaxed pairing (1.1, HIGH, L)** — do the threat-model delta and device-binding *before* building; this is the one with real, novel blast radius.
2. **Production observability trio (2.1, 2.2, 2.3 — HIGH, M/S/S)** — cheap, and they directly serve the founder's silent-failure mandate; 2.3 alone makes every existing log line durable.
3. **Audit/engine-down surfacing (2.4, 2.5 — MEDIUM, M)** — close the post-incident and dead-backend visibility gaps.
4. **Session-read caching (3.1, 3.2 — MEDIUM, S)** — highest performance ROI for the least code; everything else (3.3, 3.4, 3.5) builds on the same cache/visibility ideas.
5. **`/upload` streaming cap (1.2 — LOW, S)** — quick hardening, no new capability granted but cheap to fix.
