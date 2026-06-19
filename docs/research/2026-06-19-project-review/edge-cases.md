# GlaudeCode — Edge Cases & Correctness Bugs

> Produced by a multi-agent review (edge-cases + bugs-correctness dimensions), 2026-06-19.

This file collects concrete failure modes found by reading the code, not hypotheticals. Each item states why it matters for the actual workflow (founder runs `claude` inside shells, lid-closed, voice-first, over their own Tailscale), a suggested direction, and a rough effort. Severity is called as found — several "high" items directly defeat the stated product goal of replacing the company's built-in remote.

---

## High severity

### 1. Engine respawn silently invalidates ALL paired phone tokens — lid-closed user is locked out mid-session

**File:** `packages/engine/src/pairing.ts:3-4`, `:102-104` · supervisor `packages/desktop/src-tauri/src/lib.rs:580-587` (`spawn_engine`), `:719` (`supervise_engine`)

Pairing tokens live only in memory and "die with the engine" — the `codes`/`tokens`/`devices` Maps are constructed fresh per process. The Rust supervisor auto-respawns the engine sidecar on any post-handshake crash as a brand-new `bun` process, which instantiates an **empty** `PairingService`. Every paired device's view/steer/terminal token instantly fails verification; the phone's term-ws hits close code 4003 and falls into the re-pair flow (`conversationPage.ts:166`, `termPage.ts:545-548`).

**Why it matters:** a single silent, automatic engine crash logs out every device and forces the founder to physically return to the Mac to scan a fresh QR — directly defeating the "work away from the desk, lid-closed" goal. The respawn is invisible to the phone except as a generic disconnect; no token survives it.

**Direction:** persist a small encrypted token store (or, simpler, a stable signing key) under `~/.glaudecode` so paired tokens survive a respawn within their normal TTL — or have the Rust supervisor pass a stable signing secret into each engine spawn so re-minted tokens validate across respawns. At minimum, surface "engine restarted — re-pair" as an explicit phone-side notice instead of a generic disconnect.

**Effort:** M

---

### 2. Session inference can lock the dock onto the WRONG session in a shared cwd

**File:** `packages/desktop/src/App.tsx` (inference / `docked` lock)

Because the founder starts `claude` by hand inside shell panes, the dock/StatusBar/RightDock must infer which session belongs to a pane. The heuristic is "newest session modified in `activeCwd` within the last 2 min." If two sessions exist in the same project dir (a second `claude` in another pane on the same repo, a resumed historical session, or a worktree sharing the path), the dock binds to whichever JSONL was written most recently — possibly a different pane's session. The lock is sticky (`best.s.id !== locked`), so once it grabs the wrong one it stays until a strictly-newer session appears. Every dock action keyed off `docked` (cost, timeline, changes, handoff, conflicts) then silently operates on the wrong session.

**Why it matters:** silent mis-binding of cost/timeline/changes/handoff/conflicts to the wrong session is exactly the kind of invisible error the founder flagged as the enemy for AI-coded work.

**Direction:** correlate beyond mtime — capture the pane's cwd-switch timestamp (OSC 7) and only accept a session whose *created* time is ≥ that switch; and/or only infer when exactly one session in the cwd is live, bailing to an explicit "ambiguous — none" empty-state when 2+ are concurrently live instead of guessing.

**Effort:** M

---

## Medium severity

### 3. Tap-to-answer AskUserQuestion assumes the TUI cursor starts at option 0 — wrong option silently submitted

**File:** `packages/engine/src/conversationPage.ts:269` · `packages/engine/src/termPage.ts:265-267`, `:296-297`

Both phone surfaces answer a live AskUserQuestion by sending down-arrow × option-index then Enter, hard-assuming the highlighted row is currently option 0 (`for(var k=0;k<i;k++) seq+="\x1b[B"` then `sendText(seq+"\r")`; the multi-select path even comments "assumed to start at 0"). If the cursor is **not** at row 0 — because the user moved it with the raw arrow bar (`termPage.ts:418`), because a second paired device moved it, because Claude pre-highlights a non-default option, or because a stale render lags the TUI — the count lands on the wrong option and immediately submits it. The `conversationPage.ts:269` comment already flags "V6 hardening: live index later," i.e. known-unhandled.

**Why it matters:** this is a silent, irreversible mis-answer on the single most consequential remote action (approving / choosing).

**Direction:** stop navigating-by-count from an assumed cursor. Either read the live highlighted index from `promptState`/`agentState` and compute a relative delta; reset to a known row first (Home, or clamp up) before counting down; or, where the SDK supports it, answer via a structured RPC instead of synthesized keystrokes. Until then, disable concurrent multi-device answering.

**Effort:** M

---

### 4. Conversation page re-fetches the ENTIRE session every 2s — no pagination for huge sessions

**File:** `packages/engine/src/conversationPage.ts:296`, `:507` · dispatch `packages/engine/src/rpc.ts:353-354`

The primary mobile surface polls full session messages on a fixed 2s interval with no limit/offset (`setInterval(poll,2000)`; `poll()` calls `rpc("getSessionMessages",{id:sid,dir:DIR})`, which returns all messages). `renderChat` short-circuits the re-render on an unchanged signature, but the full JSONL is still read on the engine, mapped, serialized, and transferred to the phone every 2s regardless. For a long session (bodies can reach the 200k-char index cap; real JSONL can be multi-MB) this continuously re-ships the entire conversation over Tailscale/cellular.

**Why it matters:** unbounded bandwidth/battery/I/O cost that grows with session length, paid by the phone on the link that matters. The desktop has the same pattern but on localhost.

**Direction:** fetch only the tail (limit/offset for the last N messages) on the poll and lazy-load older history on scroll-up. Better: add an ETag / last-message-id so the engine returns empty when nothing changed, avoiding the full read+serialize per tick.

**Effort:** M

---

### 5. Conversation page resolves the session ONCE at load and never re-infers — shell swap shows a stale/empty chat

**File:** `packages/engine/src/conversationPage.ts:153`, `:282-292`, `:505`, `:507`

`resolveAndPoll()` runs once and pins `sid` (default = `paneId`); the 2s loop always uses that frozen `sid`. Unlike the desktop `App.tsx`, which re-polls inference every 3s and can switch the locked session, the phone never re-resolves. So: (1) if the page loads before any session exists, inference falls back to `sid = paneId`, shows the empty-state, and never picks up the session the user starts moments later; (2) if the user ends one `claude` run and starts another (new sessionId), the phone keeps rendering the old, idle session; (3) if inference initially locked the wrong session, it can never self-correct. The HUD shows "resolved" but there is no in-app way to re-resolve short of a full reload.

**Why it matters:** matches the founder's exact workflow (`paneId != sessionId`, sessions started/stopped by hand) and produces a permanently empty/stale chat with no obvious recovery.

**Direction:** periodically re-run inference for shell panes (mirror `App.tsx`'s 3s re-poll), or re-resolve when the current `sid` returns empty/idle for K consecutive polls. Add a manual "reselect session" control in the HUD/drawer.

**Effort:** M

---

## Low severity

### 6. Desktop presence uses window FOCUS, not real presence — phone can resize the desk PTY while the user is working

**File:** `packages/desktop/src/App.tsx:91-95` · `packages/desktop/src/resizeAuthority.ts:13-17` (`DESKTOP_PRESENCE_GRACE_MS`)

The phone may reshape the shared Mac PTY once the desktop has been "quiet" for 30s. But presence is signalled only when the GlaudeCode window is both visible **and** OS-focused (`beatIfActive = if(document.visibilityState==="visible" && document.hasFocus()) beat()`). The founder works lid-closed on an external monitor, voice-first, multi-window. Any 30s window where GlaudeCode loses OS focus while the user is still at the desk (another app, an occluding editor, a long voice dictation) stops the heartbeat, and the phone (auto-fitting to ~45 cols) then reshapes the desk terminal under them. The grace is also a single global clock shared across all panes, and at startup the 30s lockout fires even if the app launched backgrounded.

**Why it matters:** focus is a proxy for presence that diverges precisely in this user's stated workflow; the result is a surprise reflow of an active terminal.

**Direction:** heartbeat on a broader presence signal — continue while visible regardless of focus, and/or factor in recent local PTY input. Consider a longer/explicit grace, a phone-side confirmation before a resize that shrinks an active desk pane, and have the desktop re-assert its preferred size when it regains focus.

**Effort:** S

---

### 7. Cost/context model matching is first-substring-wins with no precedence — future overlapping names mis-price

**File:** `packages/engine/src/cost.ts:19` (`DEFAULT_PRICES`), `:83` (`priceFor`) · also `DEFAULT_CONTEXT_LIMITS`/`limitFor`

Matching is substring-based and order-dependent. Today the keys are `opus`/`sonnet`/`haiku` and both opus & sonnet limits are 1M — fine. But the moment Anthropic ships a name that contains an existing family token as a substring (a future tier or rename), `priceFor`/`limitFor` silently bind to whichever key was inserted first, producing a wrong-but-non-zero USD estimate and a wrong context-window denominator. `unpricedTokens` stays 0, so the misconfiguration is invisible.

**Why it matters:** no effect today; a latent, silent correctness foot-gun in two parallel tables — and silent wrong numbers are exactly what the observability-first stance wants eliminated.

**Direction:** match by longest key first (sort keys by length desc) and/or pin exact model-id prefixes with a family-substring fallback; log/flag when a model matches a heuristic rather than an exact entry so a pricing/limit gap is observable.

**Effort:** S

---

## Summary

| # | Item | Severity | Effort |
|---|------|----------|--------|
| 1 | Engine respawn invalidates all paired tokens | High | M |
| 2 | Session inference locks wrong session in shared cwd | High | M |
| 3 | Tap-to-answer assumes cursor at option 0 | Medium | M |
| 4 | Conversation page re-fetches full session every 2s | Medium | M |
| 5 | Conversation page never re-infers session | Medium | M |
| 6 | Desktop presence = window focus, not real presence | Low | S |
| 7 | Cost/context model matching is substring-first | Low | S |

The two high-severity items (#1, #2) both produce silent, away-from-desk failures that undercut the core "replace the company remote" goal and deserve attention first. #3 is the most dangerous medium — it can submit the wrong approval irreversibly. The rest are correctness hardening that aligns with the founder's observability-first stance.
