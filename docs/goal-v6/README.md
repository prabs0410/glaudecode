# GlaudeCode V6 — "The phone cockpit, genuinely usable + private"

> **This is a runnable autonomous-build goal.** Launch with `/goal @docs/goal-v6/README.md`. The loop
> implements Phases 1→6 in order, one task at a time, committing on per-phase branches with the
> per-commit gate green, **flagging (not failing on) human-gates**. Modeled on `docs/goal-v5/README.md`.

## Context

V5 proved you can drive your Mac's terminal + Claude Code from your phone; the mirror is now reliable
(the respawn-orphan blank bug was fixed on `fix/v5-audit`). V6's job: make that experience **genuinely
usable + private** — a voice-first, full-fidelity terminal + Claude Code on the phone, on the founder's
own Mac + Tailscale, that *replaces* the company-account-bound built-in remote control. The founder's
Mac built-in display is dead (external monitor at the desk), so "away" = lid closed, on charger,
network-reachable. **The raw terminal mirror is the trusted core** (it shows every Claude
approval/prompt/TUI variation natively); a conversation view is a *later, optional upgrade-on-top* that
never removes the terminal.

Full rationale: the approved plan (`/Users/prabhakaranr/.claude/plans/resilient-singing-jellyfish.md`)
and the research: `docs/research/mobile-cockpit-ux-2026-06-17.md`,
`docs/research/mobile-platform-transport-clipboard-2026-06-17.md`.

## Scope

- **Automatable (this goal):** mobile-native terminal (P1), Tailscale-Serve HTTPS default (P2),
  PWA + self-hosted Web Push (P3), clipboard Tier 1 (P4) + Tier 2 gated (P5), conversation-view upgrade (P6, optional/last).
- **Out of scope (human-gated, flagged — NOT loop failures):** app-layer E2E crypto (SPAKE2+Noise,
  release prerequisite), the managed pmset-root lid-closed keep-awake mode, the Epic-G threat-model
  review + ACL/Tailnet-Lock hardening, VAPID/cert provisioning, real-device QA, opening PRs.

## Phase 0 — prep (DONE, committed on `feat/v6-p0-setup`)

- ✅ **P0a** — `"question"` `NotificationKind` added (engine + desktop mirror) for push-on-AskUserQuestion (`bec8191`).
- ✅ **P0b** — `@xterm/addon-fit` vendored + served at `/app/addon-fit.js` + loaded in `termPage.ts` (`0a14f5d`).
- ⏳ **P0c [HUMAN-GATE]** — founder device-tests the shipped mirror fix; build the deferred Rust per-pane
  screen ring + flood coalescing **only if blank recurs**.

## Cross-phase rules (guardrails — apply to every task)

1. **Branch per phase**, named `feat/v6-p<N>-<slug>` (e.g. `feat/v6-p1-mobile-ux`). All tests + builds green on the branch before the next phase.
2. **Commits attribute to `prabs0410`** (local `user.email …+prabs0410@…`); run `git` from the **repo root**. **No AI co-author lines.**
3. **NO PR / NO merge to `main`**; **auto-merge OFF**. (PRs blocked until the founder runs `gh auth login` as `prabs0410`.)
4. **Per-commit gate (all green):** `cd packages/engine && bun test` · `bunx tsc --noEmit` per package · `bunx vite build` (desktop) · `cargo check`/`cargo test` (`src-tauri`).
5. **All Claude Code access via `ClaudeCodeAdapter`** (Constitution Principle XI) — never raw `~/.claude` JSONL, no tight polling.
6. **One task at a time, in phase order.** Don't start the next until the current is committed + green.
7. **Stop after 2 consecutive failed attempts** on a task; leave a note; move on or await the founder.
8. **Keep docs honest:** update `AGENTS.md`/`docs/INDEX.md`/`docs/state.md` as relevant (Principle IX). These three are founder-curated — make **minimal, flagged** edits.
9. **Design-doc-first + TDD:** read the phase's design doc before building; pure logic tested in `@glaudecode/engine`; **mirrored fns (`ctrlByte`/`wrapForPaste`/`coalesceNotifications`) change in BOTH places**.
10. **Security invariants:** never bind `0.0.0.0`; TLS-or-refuse for non-loopback; the served phone pages are template literals (a `\"` breaks the whole script — the parse-guard test catches it).
11. **Engine changes need an app restart to verify** at runtime (the Bun sidecar respawns on launch); `[DEVICE-GATE]` behavioral checks are the founder's, not the loop's.

## Master human-gate checklist (loop flags + skips — **never a loop failure**)

A task needing external action is flagged and skipped, not failed. **Only a failed CI gate or a
2-attempt limit on an automatable task counts as a failure and stops the loop.**

- [ ] **[BLOCKING PRE-GATE for P2]** Founder enables Tailscale **MagicDNS + HTTPS certs** in the admin console.
- [ ] **Keep-awake reachability:** `caffeinate` keeps a desk Mac (lid open) reachable — enough for P2/P3. Lid-closed away needs Amphetamine / `sudo pmset disablesleep` (human). A managed pmset-root mode is deferred (built on the P1.7a display-power hook).
- [ ] **Epic-G threat-model** review + must-hardens before relying on remote bind: deny-by-default Tailscale ACL grant, enable Tailnet Lock.
- [ ] **VAPID:** loop auto-generates a keypair (founder can swap a persistent one); real-push test is a `[DEVICE-GATE]`.
- [ ] **Phase-3 E2E crypto** — out of scope; release prerequisite; needs independent review.
- [ ] **Real-device QA** for every `[DEVICE-GATE]` (Android primary; iOS when OSS).
- [ ] **Tier-2 clipboard** exfil surface documented in the threat model.
- [ ] **`gh auth login` as `prabs0410`** → open/merge PRs.

---

## Phase 1 — Mobile-native terminal  ·  branch `feat/v6-p1-mobile-ux`  ·  design: `docs/design/mobile-native-terminal.md`

The #1 priority. Each task: a machine-**Verify** (build + CI) separate from a `[DEVICE-GATE]` behavioral check.

- **Story 1.1 — Touch-scroll (S).** `overscroll-behavior:none` on html/body; `#term { overscroll-behavior:contain; touch-action:pan-y; overflow-x:hidden }`; drop the redundant nested scroller so `.xterm-viewport` owns scroll; inject `.xterm-viewport{overscroll-behavior:contain}`. Anchor `termPage.ts:32`.
  - *Verify:* engine `bun test` (parse-guard green) + `tsc`. *Review:* code-review. *[DEVICE-GATE]:* pull-down does NOT reload.
- **Story 1.2 — Fit-to-width (M).** Use the P0b FitAddon (`globalThis.FitAddon.FitAddon`); `fit.fit()` after `term.open()` + on layout/visualViewport/orientation (debounced); **fit-by-default for ALL scopes** (ungate from `canTypeScope`/`sizeOn`/`armed`); retire the guessed-metrics path (`termPage.ts:379-394`); guard the null-cell-metrics case. *Verify:* tests + build. *[DEVICE-GATE]:* no horizontal cutoff.
- **Story 1.3 — Soft-keyboard (M).** `interactive-widget=resizes-content` + `100dvh` flex; keep the VisualViewport path feature-gated for iOS; `fit.fit()` on keyboard open/close; wire for ALL scopes. *[DEVICE-GATE]:* input bar not covered.
- **Story 1.4 — Readable text (S).** Default fontSize 15–16; `#tin` ≥16px (kills iOS auto-zoom); A−/A+ controls; persist in **localStorage**.
- **Story 1.5 — Sticky-Ctrl key bar (M).** Collapse the chip-wall to Esc/Tab/⇧Tab/arrows/Enter + one **sticky Ctrl** (covers ^C/^D/^R/^L/^A/^E/^U/^K/^W/^Z) + PgUp/PgDn + the Claude-Code quick-insert chips `/ @ # !`. Reuse `ctrlByte` (`termInput.ts`).
- **Story 1.6 — Multi-session switch (M).** A usable session list/switcher for ~4–5 sessions, flagging which needs attention (reuse `listPanes` + `agentState`).
- **Story 1.7 — Resize authority.**
  - *1.7a (automatable):* detect lid-closed/no-desktop-viewer — a Tauri display-power hook → a `LOCAL_ONLY` `lidClosed()` RPC; **"no desktop viewer" = no authenticated steer+ desktop socket sustained >30s (configurable grace)**; log every authority transition to the audit. *Verify:* unit-test + build.
  - *1.7b `[DEVICE-GATE]`:* phone owns cols/rows only when granted AND (desktop absent >grace OR lid-closed); revert at the desk.
  - *RESIZE* goes through a **dedicated `gateResize`** (NOT `gateTerminal`): terminal scope + token + armed AND the authority state. *Verify:* CI asserts RESIZE rejected when a desktop steer+ socket is active or the lid is open.

## Phase 2 — Transport: Tailscale Serve / TLS  ·  branch `feat/v6-p2-serve`  ·  design: `docs/design/transport-options-phone-to-mac.md` + research

- **Story 2.0 [HUMAN-GATE, blocking pre-gate].** Founder enables Tailscale **MagicDNS + HTTPS certs** (Serve can't mint valid certs without it). *Review:* founder confirms.
- **Story 2.1 — Serve as the blessed default.** Upgrade `server.ts:200` `http://` → `https://` on the `*.ts.net` MagicDNS name; keep TLS-or-refuse for non-loopback; never bind `0.0.0.0`. Anchors `lib.rs tailscale_serve_*` (~906-991). *Verify:* tests + `cargo check`. *[DEVICE-GATE]:* cockpit loads over https; `navigator.clipboard` + service-worker registration now available.
- **Story 2.2 — Onboarding UX.** QR + status pointing at the `.ts.net` https name (PairingModal).
- **Story 2.3 — OSS alternatives + ACL warning.** Document NetBird-self-host / WireGuard+VPS; emit a startup WARNING if remote is enabled and the Tailscale ACL can't be verified (deny-by-default grant).

## Phase 3 — PWA hardening + push  ·  branch `feat/v6-p3-push`  ·  design: `docs/design/pwa-push.md`  ·  gated on P2 HTTPS

- **Story 3.1 — PNG maskable icons** (replace the SVG data URI, `cockpit.ts:26`).
- **Story 3.2 — Service worker** (offline shell + `push` handler), served like the manifest.
- **Story 3.3 — Self-hosted VAPID Web Push.** Loop **auto-generates a VAPID keypair persisted in engine config** (founder can swap a persistent key). Specify **`POST /push-subscribe` — require steer+ scope, rate-limited per device, audited `{deviceId, action}`**. *Verify:* unit-test key-gen + persistence + a view-only token gets **403**; build. *[DEVICE-GATE]:* a real push lands on an installed Android PWA.
- **Story 3.4 — Notify policy.** Wire `notify.ts` (incl. `question`): approval + question + done/idle + error; **never per-message**; per-session mute. Severity tiers optional/deferred.

## Phase 4 — Clipboard Tier 1 (phone→Mac)  ·  branch `feat/v6-p4-clipboard-t1`  ·  design: `docs/design/clipboard-bridge.md`  ·  gated on P2 HTTPS

- **Story 4.1 — 📋 Paste.** `navigator.clipboard.readText()` → **1-line preview** → `sendText(wrapForPaste(text))` (**no auto-Enter**). Reuses the audited input path (`gateTerminal`, 256 KiB cap) — this is also the long-paste fix.
- **Story 4.2 — Paste & run** (deliberate second control; appends `\r`).
- **Story 4.3 — ⧉ Copy selection** (`navigator.clipboard.writeText(term.getSelection())` bound to the tap).

## Phase 5 — Clipboard Tier 2 (Mac→phone, gated)  ·  branch `feat/v6-p5-clipboard-t2`  ·  design: `docs/design/clipboard-bridge.md`

- **Story 5.1 — Tauri clipboard plugin** + the `src-tauri/capabilities/default.json` permission.
- **Story 5.2 — `readMacClipboard` RPC** in **`TERMINAL_ONLY_METHODS`** (empty today, `rpc.ts:205`): union + `METHODS` + dispatch + scope-classification test + client wrapper.
- **Story 5.3 — Gating.** Desktop opt-in OFF by default + terminal scope + armed + **per-device "clipboard reader" enrollment allowlist** (Pairing-modal checkbox per device, default OFF, revocable) + per-pull consent + content-free `mac-clipboard-read` audit (`{deviceId, deviceName, byteCount}`); **pull-only**. *Verify:* CI asserts an un-enrolled / view / steer token is rejected.

## Phase 6 — Conversation-view upgrade (LATER / optional)  ·  branch `feat/v6-p6-conversation`  ·  design: `docs/design/conversation-view.md`

The raw terminal stays the trusted core, one tap away, the auto-fallback.
- **Story 6.1 — Structured surface** (bubbles + status) from the typed path (`getSessionMessages`/`promptState`/`agentState`); raw terminal one tap away + auto-fallback.
- **Story 6.2 — Harden tap-to-answer BEFORE promoting it:** engine reports the live highlighted index / accepts an absolute "select option N" intent (fixes the assume-row-0 cursor math; makes multiSelect reliable; note the `paneId===sessionId` worktree caveat).
- **Story 6.3 — Status chip** bound to `agentState`. (Diffs low-priority → optional.)

---

## Founder decisions (defaults locked — see the plan)

| Decision | Value |
|---|---|
| Platform | **Pure PWA forever** (no native) |
| Transport | **Tailscale Serve** (HTTPS hinge); not bare-IP, not Funnel; no public tunnels for the shell |
| Clipboard | T1 phone→Mac (ship) + T2 Mac→phone (build, gated) |
| Push | approval + question + done/idle + error; never per-message; per-session mute; self-hosted VAPID |
| E2E crypto | **OUT** (human-gated release prereq) |
| Device class | Phone-first; tablet a free FitAddon win (optional) |
| Branch/PR | Branch per phase as `prabs0410`; **no PR/merge**; auto-merge OFF |

## How this gets executed (the loop)

Phase 0 prep is committed. The loop runs Phases 1→6 in order on per-phase branches, per-commit gate
green, flagging human-gates into the checklist above (never stalling). The founder device-tests each
phase's `[DEVICE-GATE]` items and runs `gh auth login` as `prabs0410` to open/merge PRs when ready.
