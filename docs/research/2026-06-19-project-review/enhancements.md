# GlaudeCode — Enhancements & Opportunities

> Produced 2026-06-19 by a multi-agent review (UX/product, DX/maintainability, competitive, pain-point research).

This is a candid working list. Severities are called as the reviewers saw them; nothing here is padded. Effort is a rough S/M/L/XL. File:line references point at the exact code the input agents inspected.

---

## Quick wins

Small, high-leverage fixes. Several are correctness/trust bugs, not polish.

### 1. AskUserQuestion tap-to-answer can submit the WRONG option (medium, effort S)
- **File:** `packages/engine/src/conversationPage.ts` (mirrored in `termPage.ts`).
- **Why it matters:** The single most valuable mobile interaction — tapping an option card to answer a Claude `AskUserQuestion` — is implemented by emitting a hardcoded number of down-arrows equal to the option's array index, then Enter. There is no read-back of where Claude's selection cursor actually is. If the desktop highlight isn't on option 0, the phone silently submits the wrong choice — including Deny-vs-Allow-class decisions — with zero feedback to a lid-closed user. This is exactly the "approval-desync" failure the product exists to kill.
- **Direction:** Make selection absolute, not relative. Best: drive the answer through a typed RPC (a `resolveApproval`-style call) instead of synthesizing arrow keys. Cheaper interim: expose the current highlighted index via `promptState` and compute the delta, OR send a deterministic reset (repeated Up beyond the option count) before the N down-arrows so the cursor starts at 0.

### 2. Unified `verify` command — the 5-step gate exists only as prose (medium, effort S)
- **File:** root `package.json`; `CLAUDE.md:37`; `.github/workflows/ci.yml`.
- **Why it matters:** The canonical gate is `bun test` (engine) + `tsc --noEmit` per package + `vite build` + `cargo check` — five commands across four directories, documented only as prose. Root `package.json` defines only `desktop` and `desktop:build`. CI re-encodes the same steps by hand, so docs and CI already drift (CI runs extra desktop+rust tests the docs omit). Onboarding friction is high and local/CI divergence is silent.
- **Direction:** Add a root `bun run verify` that chains all five steps, then have CI call that one script. One command, one source of truth.

### 3. INDEX.md / doc drift (low, effort S)
- **File:** `docs/INDEX.md:67-71`; `CLAUDE.md:37,79`; `docs/design/diagnostics-observability.md`.
- **Why it matters:** The project leans hard on "read INDEX.md first," and INDEX.md is wrong in three concrete ways: (1) `docs/design/diagnostics-observability.md` and `docs/design/mockups/` are untracked AND unindexed, breaching the project's own Constitution IX rule; (2) INDEX.md:67-71 promises `docs/architecture/` long-form design that was never written (folder holds only a README); (3) the "255+ tests" claim (`CLAUDE.md:37`, `state.md`) is stale — the suite actually runs ~387 tests / ~1322 expects across ~50 files, roughly 50% under-counted.
- **Direction:** Index the two new docs and commit them together; either write the architecture doc or repoint INDEX.md at the ADR/design folders; replace the hardcoded test count with a non-numeric reference (`bun test`) so it can't go stale.

### 4. Mirror-drift guard is incomplete (medium, effort S)
- **File:** `packages/desktop/test/mirror-drift.test.ts`; `TerminalPane.tsx`; `packages/engine/src/termInput.ts`.
- **Why it matters:** Several pure functions are hand-mirrored into the WebView (which can't import the Node-only engine). The drift test guards only four (fuzzy, osc, keybindings, notify) and does so over a fixed case-list, not byte-identity. Two security-relevant mirrors are **uncovered**: `wrapForPaste` (the paste-jacking scrub) and `filterSessions`. A one-sided edit to the paste scrub or session filter ships green — the exact divergence the guard was meant to catch.
- **Direction:** Add `wrapForPaste` and `filterSessions` to the test; strengthen from a fixed case-list toward property-based/fuzzed inputs or a source-text hash. Better long-term: extract these pure fns into a tiny SDK-free package both sides import, eliminating the mirror.

---

## Product enhancements

Bigger UX gaps in the current V6 conversation/cockpit surface.

### 5. Conversation view renders an INFERRED (possibly wrong) session with no correction path (HIGH, effort M)
- **File:** `packages/engine/src/conversationPage.ts` (mismatch only visible at HUD line ~198 `session: ... (inferred)`).
- **Why it matters:** When the founder runs `claude` inside a shell pane (their stated normal workflow), `paneId != sessionId`, so the chat is rendered from a guessed session — the newest-modified one in a single global `defaultDir`. With two active sessions in a project, or work in a non-default directory, the phone shows one session's transcript while keystrokes go to a different pane. The only signal is buried in the debug HUD. The drawer's Sessions tab lists panes, not the read/type mismatch.
- **Direction:** When `sid != paneId`, surface a small "showing session X — typing to pane Y" chip with a tap-to-correct picker in the main view. Resolve cwd **per-pane** (from the OSC-7 cwd the Rust core already tracks) instead of one global `defaultDir`, so inference scopes to the right project.

### 6. Power features are entirely undiscoverable (medium, effort M)
- **File:** `packages/engine/src/conversationPage.ts`.
- **Why it matters:** For an observability/power-user product, the richest interactions are invisible. A freshly paired device shows a `⌘` puck and a `☰` with zero indication the puck is a 6-way radial keyboard or that the status chip opens diagnostics. No first-run coach-mark, no legend, no `?`. This directly undercuts the voice-first/lid-closed value prop — the user must already know the gestures.
- **Direction:** One-time coach overlay on first load (dismiss → localStorage) labeling the puck gesture map and the tap-for-diagnostics chip; brief toast legend the first time the radial blooms; a persistent tiny `?` to re-open the legend.

### 7. Voice-first ergonomics + send-failure feedback (low→high value, effort M)
- **File:** `packages/engine/src/conversationPage.ts`.
- **Why it matters:** This is the most-requested gap in the whole category (Claude Code issue #29399: "mobile is unusable without dictation," "45s of talking vs 5+ min of thumb-typing"). Today the composer offers no first-class dictation and no safety net: a long dictated message commits to the live PTY on Enter with no confirm/undo, the send-failure path is silent (message sits in the box, nothing says it didn't go), and there's no per-message echo until the next ~2s poll. On a flaky/lid-closed link a dropped-WS message is silently lost — the exact "silent failure" the founder calls the enemy.
- **Direction:** Add a press-and-hold mic (Web Speech API where available); optimistically render the sent message as a pending user bubble immediately; show an explicit error toast when `sendText` returns false ("not connected / view-only — re-pair with Terminal"); add a brief "sending…" state.

### 8. Pairing onboarding leaks unrecoverable states (low, effort M)
- **File:** `packages/desktop/src/PairingModal.tsx`.
- **Why it matters:** First-run pairing has silent dead-ends: (1) when Tailscale Serve is unavailable the QR points at an `http` origin, so the PWA isn't installable and clipboard-image/Web-Push silently don't work — the desktop warns (line ~137) but the phone surface doesn't; (2) a code that expires while you walk to your phone yields an opaque "pairing failed" with no countdown and no auto-refresh; (3) for terminal scope the QR carries an RCE-capable code over a possibly-non-secure context. None have an in-flow recovery affordance on the phone.
- **Direction:** Live expiry countdown + auto-mint (or tap-to-regenerate) on the desktop; cockpit pairing gate detects expired/invalid codes and prompts "ask the Mac for a new code"; badge the phone when on a non-HTTPS/non-installable origin so the user knows why install/clipboard/push are missing.

---

## Competitor-inspired ideas

Patterns validated by competitors that map onto modules GlaudeCode already has. None require abandoning the Claude-Code-depth thesis.

### 9. Native push when the agent needs you (HIGH value, effort M–L)
- **Why it matters:** This is the table-stakes gap across the entire field. Blink, VibeTunnel, and DIY tmux/ntfy setups all lack it or hand-roll it; Claude Code issue #29438 ("no push notification when the CLI needs permission approval... you have to babysit the session") confirms the pain. The async loop — kick off, pocket the phone, get pinged only when blocked — doesn't work without it. Omnara/Cursor lead their marketing with exactly this.
- **Direction:** Ship Web Push (already the pending HTTPS/MagicDNS-gated item) wired directly to approval-needed / agent-finished states via the existing arming/audit channel. Turns "monitor" into "get pulled in only when needed."

### 10. Session-survives-sleep as a first-class, observable guarantee (HIGH value, effort M)
- **Why it matters:** Omnara's cloud-handoff and the DIY tmux pattern both win on "close the laptop and it keeps working." GlaudeCode owns the host (Rust core owns PTYs, engine is a persistent sidecar) so it can do this **without** copying code to a vendor cloud — the cleanest privacy contrast in the field. But the lid-closed keep-awake problem (macOS sleeps on lid-close; `caffeinate` only covers idle sleep) is real and the input agents flag it as under-served.
- **Direction:** Manage power assertions for lid-closed operation host-side so it "just works"; surface a "host will sleep / staying awake" signal in the debug HUD (founder is observability-obsessed). Frame as "tmux-grade durability, zero setup."

### 11. Glanceable multi-session status (medium, effort M)
- **Why it matters:** Wave's hook-driven tab badges (awaiting-permission / done / AskUserQuestion), Hoshi's live session thumbnails, and Windsurf's Running / Waiting-for-Review / Done Kanban are all beloved at-a-glance patterns. GlaudeCode has richer typed data than any of them but only exposes panes in a drawer list.
- **Direction:** Add at-a-glance status chips (running / waiting-on-you / done) to the cockpit session list, driven by `agentState` / `promptState`. "Waiting for you" should be the push-worthy, prominent state.

### 12. One-tap saved prompts ("snippets") (low, effort S–M)
- **Why it matters:** Termius proves saved one-tap prompts ("run the tests and fix failures") are a daily-use mobile feature. Cheap to add given the existing prompts drawer.
- **Direction:** Let users save and fire canned Claude prompts from the phone with one tap, surfaced in the everything-nav drawer.

### 13. Mobile-legible diff / changes glance (low priority per founder, effort M)
- **Why it matters:** Reviewing diffs on a 6-inch terminal is "barely wider than a function signature"; people merge blind (Builder.io, GitLab #21348). Zed/Conductor/Cursor treat diff review as core. The engine already computes `changes`/`conflicts`, and `conversationPage` is native chat (the right primitive). Founder rates this low-priority, so it's a lower tier — but a read-only diff glance would let people stop approving blind.
- **Direction:** A lightweight, horizontally-scrollable diff/changes view rendered from the existing engine modules. Not a full editor.

---

## Bigger bets

Structural or strategic; higher cost, higher payoff.

### 14. Land the unmerged branch backlog into main (HIGH, effort L)
- **File:** git (`feat/v6-conversation` vs `main`); `CLAUDE.md:20`.
- **Why it matters:** This is the single biggest maintainability liability. The whole product history (V1→V6, ~219 commits) sits on ~27 unmerged `feat/*` branches; `main` holds only docs. The active branch is 30+ commits ahead. Root cause is admitted in `CLAUDE.md:20`: PRs are blocked on `prabs0410` gh auth (gh is logged in as `ashinclude`). Consequence: no code review has ever run on shipped code, every BUILD-LOG "COMPLETE" claim is unverifiable against trunk, and branch drift compounds daily.
- **Direction:** Unblock gh auth for `prabs0410` (the documented blocker), then land branches into `main` in dependency order (V1→V6) via PRs so `pr-review-toolkit` / `code-review` actually run. At minimum, fast-forward the stable V1–V3 stack to `main` so future branches rebase on a real trunk instead of stacking indefinitely. (Note the git-identity rules in `CLAUDE.md:81-101` before any push.)

### 15. Make the AskUserQuestion / approval channel typed end-to-end (HIGH value, effort M–L)
- **Why it matters:** Quick win #1 patches the symptom; the durable fix is to stop synthesizing arrow keys for structured prompts entirely. Anthropic's own Remote Control is riddled with approval-desync bugs (issues #52084, #35637, #51267) — approvals that don't release the host, prompts that don't render, sessions only Esc-recoverable locally. GlaudeCode's whole pitch is "approval-faithful." A typed `resolveApproval`/structured-prompt RPC (read current state → submit absolute choice) makes mobile approvals authoritative and removes a whole class of desync.
- **Direction:** Add an engine RPC that reads the live prompt state and submits an absolute selection, replacing arrow-key synthesis for `AskUserQuestion` and permission prompts. Keep the raw terminal mirror as the fallback for prompt varieties not yet typed.

### 16. Parallel / multi-session cockpit fan-out (medium–high value, effort L)
- **Why it matters:** Parallel agents are the 2026 power-user magnet (Zed's first-mover feature, Conductor's worktree isolation, Windsurf's command center). GlaudeCode already owns multiple PTYs/panes and has `worktree`/`metaAgent`/`handoff` modules — and could do this **lid-closed from the phone**, which every desktop-bound competitor structurally cannot.
- **Direction:** Surface "run N Claude sessions at once" with a phone-watchable dashboard fanning across panes/worktrees, built on the existing pane registry + status chips (#11) + push (#9).

### 17. Extract mirrored pure-fn into a shared SDK-free package (medium, effort L)
- **Why it matters:** The hand-mirroring of pure fns between engine and WebView (forced because the WebView can't pull the Node-only SDK) is a recurring correctness hazard — see #4 and the paste-scrub gap. A test guard mitigates; eliminating the mirror removes the failure mode.
- **Direction:** Pull the genuinely host-agnostic pure fns (`fuzzy`, `osc`, `keybindings`, `notify`, `wrapForPaste`, `filterSessions`, `termInput`) into a tiny zero-dependency package both sides import. Removes the "change both / drift" tax entirely.

---

## Severity roll-up

| Severity | Items |
|---|---|
| HIGH | #5 inferred-session, #14 unmerged branches; high-value bets #9 push, #10 sleep, #15 typed approvals |
| Medium | #2 verify, #4 mirror-drift, #6 discoverability, #11 status chips, #16 parallel, #17 shared package |
| Low | #1 (medium-sev but S-effort), #3 doc drift, #7 voice, #8 pairing, #12 snippets, #13 diffs |

**If you fix only three things:** (1) the AskUserQuestion wrong-option bug (#1/#15) — it's a silent trust failure on the product's core interaction; (2) the inferred-session mismatch surfacing (#5) — same class of "wrong target, no feedback" problem; (3) unblock and land the branches (#14) so any of this gets reviewed against a real trunk.
