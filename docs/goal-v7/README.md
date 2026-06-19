# GlaudeCode V7 — Observability layer + post-review hardening (runnable goal)

> **RUN MODE (non-stop).** Work this goal top-to-bottom, one task at a time, TDD where it fits.
> After EVERY task: run the verify gate, then commit (attributed to `prabs0410`) on
> `feat/v6-conversation`. Update the Progress log at the bottom. **Human-gated items are
> FLAGGED and SKIPPED — never counted as a failure.** Stop only on a failed CI gate that
> survives 2 attempts, or when every non-gated task is done. Token budget: consume freely
> (ultracode) until the work is complete or tokens run low.

## Context

The 2026-06-19 multi-agent review (`docs/research/2026-06-19-project-review/`, 42 confirmed
findings) found the V6 mobile cockpit is the least-tested/observable part of the codebase and
that away-mode isn't deliverable end-to-end. The founder chose to build the **monitoring / logs /
APM / observability layer first**, then grind the automatable backlog. Foundation already shipped:
**OBS-1** durable engine logs (`9b4d38e`) + **OBS-2** EventLog hub + `diagnostics()` RPC + full
instrumentation (`27c4bd3`). This goal finishes the layer and works the rest of the ranked
`BACKLOG.md` that an agent can safely do without a human gate.

## Locked decisions

- **Branch:** continue on `feat/v6-conversation` (the observability foundation is there). Commits as
  `prabs0410` (`git config --local user.email` must show `+prabs0410@…`; `git` from the repo root).
- **Verify gate (every commit, all green):** `cd packages/engine && bun test` · `bunx tsc --noEmit`
  per package · `bunx vite build` (desktop) · `cargo check` in `src-tauri` (only when Rust changed).
- **NO PR / NO merge to main / auto-merge OFF** (gh is `ashinclude`; `prabs0410` auth is a human gate).
- **Pure logic in `@glaudecode/engine`, unit-tested.** Phone pages are template literals — the
  parse-guard + no-innerHTML tests must stay green. Mirrored fns changed in both copies.
- **One task at a time; stop after 2 consecutive failed attempts** on the same task and leave a note.

## HUMAN-GATED — flag & skip (do NOT auto-build)

- **WS4 seamless pairing** (terminal-from-QR + 30-day + auto-arm) — review calls it a security cliff;
  needs a written threat-model + device-bound tokens FIRST. Owner: founder. (BACKLOG #7/#8.)
- **Push DELIVERY** — service worker + VAPID + real device need HTTPS/MagicDNS. *Buildable now:* the
  `POST /push-subscribe` route + persisted VAPID key-gen, unit-tested (Phase E); delivery is gated.
- **gh-auth + landing the 27 branches** (BACKLOG #40) — needs `prabs0410` gh login. Founder.
- **Lid-closed reachability + `lidClosed()` device test** — the display-power signal needs a device gate.
- **Clipboard image-paste** — needs the HTTPS secure context.
- **C1 / BL-4 token persistence across engine respawn** — RECLASSIFIED human-gated by the loop (2026-06-19): persisting bearer tokens to disk REVERSES an explicit audited stance (`pairing.ts`: "held in memory only — no token at rest"), and there's a real approach choice with security trade-offs: (a) persist the token store 0600/encrypted, (b) a respawn-stable HMAC signing key (tokens become self-verifying, only ONE secret at rest, + a revocation list), or (c) leave tokens ephemeral and only improve the "engine restarted — re-pair" UX. Needs a founder/threat-model decision before building. The existing 4003→re-pair flow already covers the UX minimally.

---

## Phase A — Finish the observability layer

- **A1 (OBS-3) — phone→Mac error pipe.** New `POST /clientlog-remote` (paired-token, view-scope,
  rate-limited, audited, body-capped) → records a `phone` event into the EventLog + the durable log.
  Wire `conversationPage` to POST `error` + `unhandledrejection`; add a global error handler + the
  debug HUD to `termPage` (it has neither today). Engine test: 403 for no/expired token, cap enforced.
  Verify: bun test + parse-guard + tsc.
- **A2 (OBS-4) — Mac diagnostics panel.** A desktop React panel (command-palette + a ⓘ affordance)
  that renders `diagnostics()` — the event stream (filterable by kind/level) + the health row +
  the APM metrics table. Poll on a sane interval; pause when hidden. Verify: tsc + vite build.
- **A3 (OBS-4) — phone Debug tab.** A scoped, privacy-safe `diagnosticsView` (steer) returning health
  + the non-sensitive event kinds (rpc/ws/engine/phone — never pair/revoke/audit) + metrics; render it
  as a 5th drawer tab in `conversationPage`. Verify: bun test (steer gets the subset, view 403 or empty)
  + parse-guard + tsc.
- **A4 (OBS-5) — audit surfaced on the Mac.** Render the existing `auditLog` RPC in the Mac panel (a
  tab) so the RCE trail is reviewable; pair with the durable log for persistence. Verify: tsc + vite.

## Phase B — Correctness & safety (automatable Top-10)

- **B1 (BL-3) — absolute tap-to-answer.** Stop navigating-by-count from assumed row 0. Engine reports
  the live highlighted option index (or accept a "select option N" intent it translates); disable/flag
  multiSelect. Fix BOTH `conversationPage` and `termPage`. Pure selection logic unit-tested. (Wrong-Allow bug.)
- **B2 (BL-6) — surface `sid != paneId`.** Add a visible "showing session X · typing to pane Y" chip
  with tap-to-correct in `conversationPage` (the typed-send RPC is a bigger follow-up; do the SURFACE
  now so the mismatch is never silent). Verify: parse-guard + tsc.
- **B3 (BL-9) — re-infer the phone session.** Re-resolve on K idle polls / when empty, + a manual
  reselect in the HUD (mirror the desktop's re-poll). Verify: parse-guard + tsc.
- **B4 (BL-10) — `bun run verify`.** A root script chaining the 5-step gate; have CI/docs point at it.
  Verify: the script runs green.

## Phase C — Reliability

- **C1 (BL-4) — tokens survive engine respawn.** Persist an encrypted token store (or a respawn-stable
  signing key passed into each spawn) so paired devices aren't logged out on a crash; surface "engine
  restarted — re-pair" explicitly instead of a generic disconnect. Pure store logic unit-tested. Verify:
  bun test + tsc + cargo check.

## Phase D — Perf, tests & debt (selected, automatable BACKLOG items)

Work these in BACKLOG order; each is self-contained. Skip any that turn out to need a device gate.
- **D1** visibility-gate the conversation poll (#12) · **D2** short-TTL session-snapshot cache / combined
  RPC (#13) · **D3** incremental `renderChat` (#15) · **D4** engine-down phone signal (#17).
- **D5** desktop session-inference tiebreaker + extract to a pure tested fn (#11, #34) ·
  **D6** scope classifier: make per-method scope a REQUIRED property, default-deny (#30).
- **D7** mirror-drift battery: add `wrapForPaste`/`filterSessions`/`chordFromEvent` + a hash/byte check (#26, #27).
- **D8** `/upload` streaming byte-counter (no full-buffer before the cap) (#36) ·
  **D9** cost/model match longest-key-first (#38).
- **D10** desktop React safety-surface tests (kill-switch invokes disarm; arm round-trips; pairing refuses a
  terminal token without both consent gates) — stand up vitest+happy-dom (#20).
- **D11** served-phone-JS behavioural harness: extract scripts to importable modules + jsdom (#21, #22).
- **D12** docs honesty: fix INDEX.md drift (index the new docs; "255+ tests" → actual count), repoint the
  architecture stub (#39). **FLAG for founder** before editing INDEX.md (founder curates it) — write a
  NEW pointer file + note it; don't edit INDEX.md directly.

## Phase E — Push scaffolding (buildable half only)

- **E1 (BL-5, partial) — `POST /push-subscribe`** (steer+, rate-limited, audited) + persisted VAPID
  keypair auto-gen in engine config + `shouldPush()` call-site wiring. Unit-test the route (view→403) +
  key-gen + persistence. **Delivery (service worker + real push) is HUMAN-GATED on HTTPS — flag & skip.**

---

## Cross-task rules

- Mirror the established patterns (new RPC = union + METHODS + dispatch + scope-class + client wrapper +
  index export; new Tauri plugin = cargo add + plugin init + capability permission).
- Never bind `0.0.0.0`; TLS-or-refuse non-loopback. Engine changes need an app restart to verify behaviour
  (note device-gates; don't claim device-verified).
- Keep the EventLog/audit privacy invariant: metadata only, never payloads/secrets.

## Progress log

> ⏸️ **LOOP PAUSED 2026-06-19** (founder compacting the session). HEAD `9e525b0` + the design-doc
> commit are clean and `bun run verify` is GREEN. Nothing is half-done. **To resume:** re-run the
> `/loop` (self-paced) — the next task is **D5** (desktop session-inference tiebreaker → pure tested
> fn). Remaining: D5 · D6 scope-required · D7 mirror-drift · D8 upload-streaming · D9 cost-match ·
> D10/D11 test harnesses · D3 incremental-render (after D11) · D12 docs · Phase E push scaffolding.
> Human-gated (for the founder, not the loop): **C1** token persistence · **WS4** threat-model ·
> **MagicDNS/HTTPS** (push delivery + clipboard images) · **`prabs0410` gh-auth** (land the branches).

- ✅ **OBS-1** durable engine logs — `9b4d38e`.
- ✅ **OBS-2** EventLog hub + `diagnostics()` RPC + instrumentation — `1e77031`, `27c4bd3`. (397 engine tests.)
- ✅ **A1 (OBS-3)** phone→Mac error pipe complete: `POST /clientlog-remote` + BOTH pages forward window error + unhandledrejection + tap-to-open HUD — `ffc2bd4`, `4be9183`. (398 engine tests.)
- ✅ **A2 (OBS-4)** Mac diagnostics panel — `DiagnosticsPanel.tsx` (command palette → "Diagnostics…"): live event feed (filter by kind/level), per-method APM table, health row. Polls `diagnostics()`, pauses when hidden.
- ✅ **A3 (OBS-4)** phone Debug tab + scoped `diagnosticsView` (STEER, privacy-safe subset — rpc/ws/engine/phone only, never pair/revoke/audit) — 5th drawer tab renders health + event feed. (399 engine tests.) **OBS-4 complete.**
- ✅ **A4 (OBS-5)** audit surfaced on the Mac (Audit tab) + APM metrics (already in A2's panel). **PHASE A COMPLETE — the observability layer is done.**
- ✅ **B1 (BL-3)** absolute tap-to-answer — pure `moveToOptionKeys` (pin-to-top then down×index, position-independent) + proper multiSelect (Space-toggle + Confirm), applied to BOTH pages. 402 engine tests (+3). The wrong-Allow bug is fixed.
- ✅ **B2 (BL-6 surface)** `sid != paneId` chip — when the rendered session differs from the typed pane (the claude-in-a-shell case), the bar shows "📄 session · ⌨ pane" (tap → drawer to switch). The typed-send RPC is a noted bigger follow-up. (Surface done.)
- ✅ **B3 (BL-9)** re-infer the phone session — re-resolves every ~5 empty polls (≈10s) so a chat opened before `claude` starts self-heals; the split chip/drawer are the manual path.
- ✅ **B4 (BL-10)** root `bun run verify` — chains engine test + tsc×2 + vite build + cargo check; exits 0. **PHASE B COMPLETE.**
- 🚩 **C1 (BL-4)** token persistence across respawn — RECLASSIFIED HUMAN-GATED (reverses the audited "no token at rest"; needs a founder/threat-model decision on the approach). Flagged, skipped — not a failure. See the human-gated section.
- ✅ **D1 (#12)** visibility-gate the conversation poll — `poll()` skips when `document.hidden`; re-polls on refocus. (Also forward-fixed a stray-backtick that broke the template literal in `f598f70`.)
- ✅ **D2 (#13)** combined `sessionSnapshot` RPC + 1s cache — ONE transcript read → messages + agentState + promptState (was 3 reads/poll); the phone poll now fires 1 RPC instead of 3. 403 engine tests (+1: one cached read drives all three). (Desktop pollers #33 still use the separate RPCs — a later item.)
- ⏸️ **D3 (#15)** incremental `renderChat` — DEFERRED until after D11 (the jsdom phone-JS harness): it refactors the PRIMARY chat-render path and a logic regression there would be silent without a behavioral test. Reordered, not skipped — revisit once D11 lands.
- ✅ **D4 (#17)** engine-down phone signal — after 3 consecutive failed polls a distinct "⚠ Can't reach your Mac" banner appears (tap to retry), clearing on the next success. No more silent freeze on the lid-closed surface.
- ✅ **D5 (#11/#34)** desktop session-inference tiebreaker → pure tested fn — extracted the shell-pane heuristic into `engine/src/sessionInference.ts` (`inferShellSession`, injected `now`, mirrored verbatim into `desktop/src/sessionInference.ts`). Adds a **single-live / margin tiebreaker**: a lone live session docks confidently, a decisive newest takes over, but **2+ live sessions within ~10s no longer silently bind** — it keeps a live sticky lock and surfaces `ambiguous`, rendered in `RightDock` as "⚠ Multiple live sessions here — showing the newest (may be wrong)". 12 unit tests (empty/single/two-fresh/stale/cwd-change/flap). 415 engine tests. Verified via the canonical commands (engine `bun test` + `tsc`; desktop `bun run build`).
- ✅ **GATE-FIX** — discovered while running D5: the B4 `bun run verify` script's `bun --cwd <dir> run <script>` form is a **silent no-op** on Bun 1.2.18 (prints `bun run` help, exits 0) — only `cargo check` actually ran, so the gate had been reporting **false green** since B4. Rewrote all three root scripts to portable `(cd <pkg> && …)` subshells; `bun run verify` now genuinely runs engine `bun test` (415) + engine `tsc` + desktop `bun run build` (tsc + vite) + `cargo check`, with **0** `bun run` help-dumps in the log. Added a `comment:scripts` note so the broken form isn't reintroduced.
- ✅ **D6 (#30)** scope classifier — per-method scope is now **default-DENY**, not fail-open `steer`. `methodScope` lists all four tiers explicitly and returns a new `"deny"` for anything unclassified; `levelSatisfies` denies `"deny"` to **every** level incl. the local bearer (a forgotten classification fails LOUDLY, never silently steer-reachable by a paired phone). Unknown methods now 400 at the boundary *before* the scope check (preserves the unknown-method 400; default-deny governs only known-but-unclassified). New tests in `rpc.test.ts` + the `secureDefaults` release gate assert the deny contract. 417 engine tests. **`bun run verify` genuinely green (0 help-dumps).**
- ✅ **D7 (#26/#27)** mirror-drift battery — new **gate-run** `engine/test/mirrorDrift.test.ts` (the existing desktop drift test runs only under desktop `bun test`, NOT the verify gate). Guards the security-relevant mirrors a one-sided edit could silently drift: **filterSessions** (engine ↔ desktop byte-identity + behavior), **chordFromEvent** input matcher (asserts the rest is byte-identical, pinning the TWO intentional divergences — `KeyEventLike` vs DOM `KeyboardEvent`, and host-agnostic `meta||ctrl` vs platform `IS_MAC?meta:ctrl`), and the **four paste-jacking scrubs** (canonical `termInput.wrapForPaste` + `termPage`-inline + `conversationPage`-inline + desktop `TerminalPane.scrubPasteMarkers`) — extracted via `new Function` from trusted repo source and run over a 209-case adversarial+fuzz battery: identical output to the canonical, no interior `\x1b[20[01]~` survives, and a structural fixpoint-loop guard catches any single-pass regression (the H4-fix2 bug). 425 engine tests (+8, 1066 assertions).
- ✅ **D8 (#36)** `/upload` streaming byte-counter — the route did `await request.arrayBuffer()` (buffers the WHOLE body) before the `bytes.length > cap` check, so a **chunked** body with no honest `content-length` slipped past the early 413 and could OOM the sidecar. New tested `readStreamCapped(stream, cap)` in `upload.ts` counts bytes AS they arrive and cancels the stream at the first chunk over the cap — never holding more than cap (+1 chunk). Wired into the route. Tests: 5 unit (under/at/over-cap, stops-early on an infinite stream, null body) + a server test that a 120-byte chunked body (no content-length) still 413s and writes nothing. **tsc in the now-real gate caught a bad stream-result type mid-task — fixed before commit.** 431 engine tests (+6).
- ✅ **D9 (#38)** model match longest-key-first + heuristic flag — both `cost.ts:priceFor` and `contextUsage.ts:limitFor` did first-substring-wins over `Object.keys` (order-dependent; a future model id containing a shorter family token nested in a longer key would mis-price). DRY'd into a shared, tested `matchModelKey(model, keys) → {key, exact}`: **exact key wins, else the LONGEST substring key** (deterministic, order-independent), with an `exact` flag so a heuristic family-substring match is distinguishable from a known model id. Exported; 7 unit tests (exact/heuristic/longest-wins-both-orders/mis-pricing/no-match/length-tie-stable). tsc caught a null-safety slip in the test mid-task — fixed. 438 engine tests (+7).
- ⏳ D10–D12, E pending (this loop).
