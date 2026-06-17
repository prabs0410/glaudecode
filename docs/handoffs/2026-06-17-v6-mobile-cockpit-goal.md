# Handoff — V6 "phone cockpit, usable + private" goal opens (2026-06-17)

> Frozen session snapshot that opens the V6 autonomous build. Read this, then the runnable goal at
> `docs/goal-v6/README.md`. Do not edit after the writing session (handoffs convention).

## What this is

GlaudeCode V6 makes the phone cockpit **genuinely usable + private**: a voice-first, full-fidelity
terminal + Claude Code on the founder's phone, on their own Mac + Tailscale, replacing the
company-account-bound built-in remote control. The terminal mirror is the trusted core; a conversation
view is a later, optional upgrade. Decided across a long session of deep research (two workflows) +
founder calls + an adversarial plan review.

## Locked decisions (do not relitigate — they live in the goal README + the plan)

- **Pure PWA forever** (no native — alert-then-act loop makes it unnecessary).
- **Tailscale Serve** as the one transport; its **HTTPS is the hinge** that unlocks PWA-install + Web
  Push + the clipboard API (the cockpit is plain-http on a bare IP today). No public tunnels for the shell.
- **Clipboard:** Tier 1 phone→Mac (ship; also the long-paste + voice fix) + Tier 2 Mac→phone (build, gated).
- **Push:** approval + question + done/idle + error; never per-message; per-session mute; self-hosted VAPID (no Firebase).
- **E2E crypto OUT** of autonomous scope (human-gated release prerequisite).
- **Build on branches as `prabs0410`, no PR/merge** (gh is `ashinclude`; founder auths + opens PRs later); auto-merge OFF.
- Authoritative detail: the approved plan `/Users/prabhakaranr/.claude/plans/resilient-singing-jellyfish.md`; the goal `docs/goal-v6/README.md`; research in `docs/research/mobile-*-2026-06-17.md`.

## In-flight state

- Branch **`feat/v6-p0-setup`** (off `fix/v5-audit`, which carries the working mirror fix). Phase-0 prep
  DONE + committed:
  - `bec8191` — P0a: `"question"` `NotificationKind` (engine + desktop mirror) for push-on-AskUserQuestion.
  - `0a14f5d` — P0b: vendored `@xterm/addon-fit` → served at `/app/addon-fit.js` → loaded in `termPage.ts`.
- The four design docs (`docs/design/{mobile-native-terminal, pwa-push, clipboard-bridge, conversation-view}.md`)
  + the `docs/INDEX.md`/`docs/state.md` pointers land in this same setup branch before the loop starts.
- The mirror fix (`fix/v5-audit`: `7a8f795`/`feb095d`/`18290d6`) is shipped; the founder confirms the
  mirror works on-device.

## Immediate next action

Start the loop: **`/goal @docs/goal-v6/README.md`** — it implements Phases 1→6 in order on per-phase
branches. **First real work: Phase 1 (mobile-native terminal)** — touch-scroll (1.1) is the highest-
leverage, smallest fix; then FitAddon fit-to-width (1.2, the P0b addon is already vendored + served).

## Critical context to NOT forget

- **The terminal mirror is the trusted core** — it renders every Claude approval/prompt/TUI variation
  natively, which is exactly what the built-in remote control fails at. Never let the conversation view
  (P6) remove or weaken the raw terminal.
- **HTTPS (Tailscale Serve) gates P3/P4/P5** — clipboard, service worker, and Web Push do not work over
  the current plain-http bare-IP origin. P2 must land (and the founder must enable MagicDNS + certs) first.
- **Keep-awake is the precondition for "away"** — a sleeping Mac drops Tailscale and no transport
  recovers it. The founder's Mac built-in display is dead (external monitor at the desk), so away = lid
  closed on charger; they handle reachability via Amphetamine / `pmset` (the managed root mode is deferred).
- **`[DEVICE-GATE]` items are the founder's** — the loop can run tests but cannot device-test, enable
  certs, provision VAPID, or open PRs. Human-gates are flagged + skipped, **never a loop failure**; only
  a failed CI gate or a 2-attempt limit on an automatable task stops the loop.
- **Mirrored fns** (`ctrlByte`/`wrapForPaste`/`coalesceNotifications`) live in both `@glaudecode/engine`
  and `packages/desktop/src/*` — change both. The served phone pages are template literals (a stray
  `\"` breaks the whole script; the parse-guard test catches it).
- **Git identity is load-bearing:** commits MUST be `prabs0410`, never `ashinclude`; run `git` from the repo root.

## Reference paths

- Goal: `docs/goal-v6/README.md` · Plan: `/Users/prabhakaranr/.claude/plans/resilient-singing-jellyfish.md`
- Research: `docs/research/mobile-cockpit-ux-2026-06-17.md`, `docs/research/mobile-platform-transport-clipboard-2026-06-17.md`
- Design docs: `docs/design/{mobile-native-terminal, pwa-push, clipboard-bridge, conversation-view}.md`
- Prior V5 record: `docs/handoffs/2026-06-16-mobile-mirror-and-audit-remediation.md`; security: `docs/security/`
- Constitution: `.specify/memory/constitution.md` · Working memory: `docs/state.md`, `docs/BUILD-LOG.md`
