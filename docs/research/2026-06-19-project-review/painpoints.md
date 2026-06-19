# GlaudeCode — User Pain Points & Opportunities

_Produced by a multi-agent review (2026-06-19). Synthesizes external pain-point research (HN, GitHub issues, vendor/security writeups) against GlaudeCode's shipped and planned architecture. Severity calls are candid; effort tags are rough._

This document groups evidenced developer pains around running Claude Code from a phone into four themes, maps each to a concrete GlaudeCode opportunity, and closes with the five pains GlaudeCode is _uniquely_ positioned to kill. The recurring finding: Anthropic's official Remote Control (launched 2026-02-25) and the DIY SSH/tmux stack both fail in ways that map almost one-to-one onto GlaudeCode's design. The product's job is to ship the obvious fixes, not invent new ones.

A note on honesty: GlaudeCode does not yet beat these alternatives in the wild — most of the "opportunity" below is latent in the architecture, not yet proven on a device. Two of the highest-value fixes (voice input, Web Push) are still pending. The wedge is real; the work is not done.

---

## Theme 1 — Anthropic's official Remote Control is structurally weak

This is the product GlaudeCode set out to replace, and the bug reports confirm the founder's thesis. These are not edge cases; they are the core loop failing.

### 1.1 Approval desync — approving from the phone doesn't release the host
**Severity: critical (this is the whole reason to build the product).**
Approving a tool-permission prompt from the phone does not release the prompt on the host — Claude Code stays stuck waiting, and the only fix is approving on the host machine, which defeats the entire point of remote approval. Prompts also fail to render on mobile (session looks frozen while the desktop silently waits), and "Always allow" from the Android app errors out.
- Evidence: claude-code #52084 (approve-from-phone doesn't release host), #35637 (prompts don't render on mobile, session appears frozen), #45942 ("Always allow" breaks tool calls), #29214 (prompts appear despite `--dangerously-skip-permissions`). Simon Willison confirms `--dangerously-skip-permissions` has no effect under remote-control.
- Why it matters: an agent that stalls invisibly behind an approval you can't grant is worse than no remote control — you think it's working and it isn't.
- Direction: lean on the terminal mirror as the trusted core. Because `termPage.ts` renders the REAL PTY, an approval given on the phone is the same input the host acts on — there is no re-rendered proxy to desync. The per-pane arming gate is Rust-authoritative with an engine mirror, so the approval channel is authoritative, not a lossy relay. **Effort: S** (this falls out of the existing architecture; cost is device verification, not new code).

### 1.2 Silent hangs with no remote recovery — only local Esc unsticks
**Severity: high.**
Sessions silently freeze mid-execution from mobile, and ONLY a local Esc keypress recovers them. Users lose hours and learn to trust remote control only for tiny interactions before physically returning to the laptop.
- Evidence: claude-code #51267 ("The only recovery mechanism is pressing Esc on the local terminal — no action from the mobile side can unstick it... I lost several hours of work").
- Why it matters: a "must-walk-back-to-the-laptop" failure mode destroys the away-from-desk value proposition entirely.
- Direction: the raw-PTY mirror can send ANY key (Esc, Ctrl-C) over the steer/terminal channel plus the gesture puck. There is no host-only recovery surface — a stuck session is always remotely recoverable. **Effort: S** (verify Esc/Ctrl-C path end-to-end over a real network).

### 1.3 Silent disconnects + orphaned-session graveyard
**Severity: high.**
The connection drops frequently and silently (iOS keeps showing "Interactive" with a spinner while messages fail), post-disconnect messages vanish, `/rc` can't restore the session, and dead "Disconnected" sessions accumulate with no way to delete or reconnect.
- Evidence: claude-code #28532 / #33041 (frequent silent disconnects), #34531 ("the only workaround is to start an entirely new session"), #34255 (auto-reconnect doesn't work), #61525 (orphaned sessions can't be deleted/reconnected).
- Why it matters: a lying spinner is exactly the silent-failure the founder names as the enemy.
- Direction: bind the user's OWN Mac over their OWN Tailscale (no Anthropic relay in the path); on reconnect re-read live PTY state / re-render from typed `getSessionMessages` so there's no stale-history desync. Make connection health VISIBLE in the debug HUD rather than a lying spinner. **Effort: M** (reconnect-rehydrate is real work; health surfacing is incremental on the existing HUD).

### 1.4 Account-bound, plan-gated, single-session, and entitlement-fragile
**Severity: medium-high (mostly a structural advantage GlaudeCode already has).**
Remote Control requires a Pro/Max subscription, excludes Team/Enterprise and API-key setups, caps one remote session per instance, and many paying users were locked out by credential/entitlement bugs. The session URL grants full control, so a phished Anthropic login escalates to every developer's local environment.
- Evidence: #29185 / #30242 / #33119 ("not enabled for your account"), #64070 (App-Store-billed Max: "Remote credentials fetch failed"), #29006 / #41503 (Desktop-app users locked out; usage-limit prompt unanswerable from mobile). Security: penligent.ai, agentsteer.ai ("a phished Anthropic login... grants access to every developer's local environment").
- Why it matters: tying remote access to a vendor account makes the blast radius "whoever phishes an Anthropic login," and locks out whole user tiers.
- Direction: GlaudeCode is private infra the user owns end-to-end — no account binding, no plan gate, works with any local auth. PTY/pane-keyed `PtyRegistry` makes multi-session native; session inference already handles `claude`-inside-a-shell (paneId != sessionId), which the CLI-entry-point assumption breaks. **Effort: S** (already true; the work is messaging + the WS4 token model).

---

## Theme 2 — Driving an agent from a phone (the everyday loop is broken)

The mechanics of using a phone as a cockpit — typing, reconnecting, scrolling, approving, keeping the Mac awake — are all broken on the existing paths.

### 2.1 Typing technical prompts on a phone is "unusable without dictation"
**Severity: critical — and GlaudeCode does NOT yet solve it.**
Typing detailed prompts on a phone keyboard is so slow it's the single most-cited mobile blocker. "A 30-second voice message could replace 5 minutes of thumb-typing." The dream UX: tap mic, pocket the phone, walk around, talk, tap stop.
- Evidence: claude-code #29399 ("[FEATURE] Voice input for Remote Control (mobile is unusable without dictation)"), closed as duplicate (i.e., heavily wanted). Omnara HN (itissid): "Too much typing, I generally STT into the text box."
- Why it matters: the founder's lid-closed / AirPods / voice-first workflow IS this dream UX, and voice is good precisely at natural-language _steering_ (not code dictation, where brackets/whitespace defeat it — a wrong word in prose is recoverable, a wrong bracket isn't).
- Direction: press-and-hold mic dictation on the `conversationPage.ts` input (the puck's tap=Enter already exists), brain-dumping a spoken prompt into the steer channel the engine already owns. This is the highest-value gap in the entire category. **Effort: M** (mic capture + STT wiring; on-device vs. cloud STT is a real fork to decide).

### 2.2 Connections drop on every sleep / network hop
**Severity: high.**
SSH/mosh drop the instant the phone sleeps or hops WiFi→cellular — constant on mobile — causing missed prompts and stalled agents. Even mosh+tmux "is still unpleasant."
- Evidence: Builder.io ("SSH drops the moment your phone sleeps or hops from WiFi to cellular"), HN #41450058, getmoshi.app, ELM Labs (SSH-only stability "a dealbreaker").
- Why it matters: a fragile interactive socket is the wrong primitive for a phone.
- Direction: the cockpit is a PWA over the engine's HTTP/WS RPC on the user's own Tailscale; session state lives in the engine + Claude session, not in a socket. The WS reconnects and re-renders the same session; WS4's 30-day auto-arm token removes re-pairing friction on every reconnect. **Effort: M** (robust WS reconnect + WS4 token are the load-bearing pieces).

### 2.3 Scrollback is hostile; long output (diffs/logs) scrolls off and is gone
**Severity: high.**
Mosh has no scrollback; tmux scrollback needs `Ctrl+b [` + arrow keys and swipe-up does nothing. Agents emit hundreds of lines of diffs/logs, so the output you most need is exactly what disappears.
- Evidence: getmoshi.app ("that output is gone the moment it leaves the screen"), DEV.to shimo4228 (copy-mode required on iPhone), HN #25741872 (mosh scrollback capped at window height).
- Why it matters: review is the core loop; the existing paths make it impossible.
- Direction: native chat scrollback is free — `conversationPage.ts` holds full history from `getSessionMessages`, so swipe-to-scroll, search, and re-reading a 500-line diff are normal gestures with no copy-mode. This turns Mosh/tmux's worst weakness into a default strength. **Effort: S** (largely shipped; the win is leaning into it).

### 2.4 Raw-TUI rendering corrupts over mobile SSH
**Severity: medium.**
Relaying an interactive TUI over mobile SSH shows stale frames, MOTD/approval dialogs bleed into the transcript, long responses become "effectively unreadable," and keyboard input can silently stop after a CLI version bump.
- Evidence: openai/codex #24235 (stale frames, "effectively unreadable in Termius"), claude-code #22948 (keyboard input stops in the TUI over SSH from Termius iOS).
- Why it matters: an entire class of bugs that simply doesn't exist if you don't relay raw ANSI.
- Direction: reading typed session messages via the Agent SDK adapter (Constitution XI — never raw ANSI/altscreen) sidesteps stale frames, MOTD bleed, and altscreen/keyboard-mode mismatch entirely. **Effort: S** (structural; already the design).

### 2.5 Copy/paste is finger-impossible on a mobile terminal
**Severity: medium.**
Selecting a 100+ char OAuth URL by touch is "nearly impossible," and Termius "Copied" often doesn't reach the system clipboard.
- Evidence: DEV.to shimo4228 (OAuth URL selection "nearly impossible"; Termius copy doesn't paste into Safari).
- Why it matters: auth flows and snippet movement are routine and currently miserable.
- Direction: native chat makes messages, code blocks, and links tap-to-copy / tap-to-open as first-class affordances. Smart upload (`POST /upload`, @-referenced) covers inbound; structured copy-out closes the gap. Image-paste is already on the HTTPS/MagicDNS roadmap. **Effort: S** (copy-out affordances) **/ M** (image-paste, gated on HTTPS).

### 2.6 The Mac must stay awake; lid-closed sleep fights you
**Severity: high (and an explicit founder requirement).**
The host must stay powered with the terminal open; macOS sleeps on lid-close. `caffeinate` covers idle sleep but not lid-closed sleep, and Claude Code respawns `caffeinate` every 300s. A ~10-min network outage also kills the official session. "Your laptop's battery is now an infrastructure dependency."
- Evidence: Builder.io, Kanaries/Macchiato (caffeinate ≠ lid-closed), claude-code #21432 (disable forced caffeinate), #25746.
- Why it matters: lid-closed / dead-Mac-display is the founder's actual workflow; if the lid kills the session the whole product fails.
- Direction: own the host side (Rust core owns PTYs independent of any foreground terminal window; persistent Bun sidecar) so display sleep / lid-close need not end the session, and there's no cloud timeout (transport is the user's own Tailscale). At minimum, surface a "host will sleep" diagnostic in the debug HUD and guide the pmset/keep-awake step. **Effort: M–L** (robust lid-closed keep-alive is genuinely hard on macOS; the HUD diagnostic is the cheap honest fallback).

### 2.7 No push notification when the agent blocks on approval
**Severity: high — and pending, not shipped.**
There's no push notification when the CLI needs approval; the session "silently blocks until you happen to check the app," forcing babysitting that "defeats the purpose of remote control."
- Evidence: claude-code #29438.
- Why it matters: "kick off, walk away, get pinged to approve" is the async promise that makes a cockpit worth having.
- Direction: Web Push is already the pending HTTPS/MagicDNS item. Shipping it makes the async loop real, on the user's own infra, with no account-bound desync. **Effort: M** (Web Push + HTTPS/MagicDNS prerequisite).

### 2.8 The DIY stack is a fragile five-tool glue job
**Severity: medium.**
Termux + SSH + tmux + mosh + Tailscale + sleep hacks "just works once configured" but coordinates five tools across desktop/phone/network and re-auths on every launch — "impossible for anyone but me to understand."
- Evidence: skeptrune.substack.com (five Unix tools, "assumes you have a desktop that stays on"), Omnara HN cadamsdotcom ("impossible for anyone but me to understand"), DEV.to shimo4228 (re-auth every launch).
- Why it matters: this DIY effort is itself proof of demand — and the maintenance burden is the opening.
- Direction: collapse the stack into one engine serving dependency-free PWA pages + QR pairing over existing Tailscale — no Termux, no tmux copy-mode, no per-launch re-auth (WS4: scoped 30-day token + auto-arm). This is the integration-depth bet over a meta-layer. **Effort: M** (the pieces exist; WS4 seamless pairing is the remaining glue).

---

## Theme 3 — Trust & security of remote control

Steering a permission-broad agent from a tiny screen between meetings is the sharpest fear. Real agents have wiped production databases; CVEs have shown trust prompts can be bypassed. The bargain today is bad: vendor cloud (leakable session URLs) or raw SSH (no native approval/diff UX).

### 3.1 Routing proprietary code/sessions through a vendor relay
**Severity: high (and GlaudeCode's core structural answer).**
SaaS mobile-agent apps (Omnara, Happy, etc.) proxy your session — and your code — through a third-party server. For proprietary/sensitive codebases that's a dealbreaker. Anthropic explicitly declined to build a Tailscale-only `--serve` mode.
- Evidence: Omnara HN jdmoreira ("If you can see the messages... that's a deal breaker... If it's encrypted end-to-end then I'm in"), claude-code #25746 ("My code never leaves my network" — closed as not planned).
- Why it matters: this is the #1 trust objection against every SaaS competitor, and Anthropic punted on the exact request.
- Direction: GlaudeCode's literal architecture — engine serves PWA pages reachable ONLY over the user's own Tailscale, no public ingress, audit log records metadata only (never payloads), no token in URL. Code and session never touch anyone else's server. **Effort: S** (already true; lead with it).

### 3.2 Leaked session URL / phished login = local RCE
**Severity: high.**
A leaked session URL/QR or phished Anthropic login becomes an authenticated channel into the whole dev box (SSH keys, AWS creds, `.env`, home dir) — "equivalent to exposing an admin console."
- Evidence: agentsteer.ai, penligent.ai.
- Why it matters: a single leakable link should not equal full RCE.
- Direction: no vendor-account-bound session URL. Access is gated by scoped paired tokens (view < steer < terminal) over the user's own Tailscale, no-token-in-URL rule, metadata-only audit log. The blast radius is the user's own Tailnet, not "whoever phishes a login." **Effort: S** (shipped; harden + document).

### 3.3 Approval fatigue is worse on a phone
**Severity: medium-high.**
Claude Code fires ~100 permission prompts/hour; approving "from the couch" trains reflexive Approve taps. The failure mode is blind-approving a multi-line shell command and watching your home directory delete.
- Evidence: codeagentswarm, hoop.dev, agentsteer.ai (Anthropic itself flags approval fatigue as a safety problem). Destructive-action precedents: PocketOS (prod DB deleted in 9s incl. backups), Replit (1,200+ companies' data wiped during a freeze).
- Why it matters: the phone must not become a blind approve-button.
- Direction: full-fidelity means the phone sees the SAME prompt + context as the desktop (informed, not lossy). The per-pane ARMING gate keeps the high-consequence typing/RCE channel OFF by default — deliberate arming converts reflexive taps into explicit friction-on-purpose. An unattended session can be left view-only and physically cannot execute a wipe until a human arms it. **Effort: S** (shipped; WS4 must not silently erode this — see caveat below).

### 3.4 Stolen-phone risk + distrust that "Allow" is real authorization
**Severity: medium.**
A phone with remote control becomes a privileged credential ("if someone steals your phone, they can access your desktop"), and CVEs (e.g., trust-prompt bypass, key exfil before the prompt) erode trust that a tap is real authorization.
- Evidence: skeptrune.substack.com, thehackernews.com (CVE-2026-21852 leaked keys before the trust prompt; CVE-2025-59536 overrode explicit approval).
- Why it matters: device theft shouldn't equal full desktop access.
- Direction: tiered, revocable scoped tokens + per-pane arming + metadata-only audit log mean a stolen phone is limited to its paired scope (default view, not terminal) and is revocable. The engine — Rust-authoritative arming + rate limits — is the authority, not a single tap. **Effort: S** (shipped; add explicit revocation UX).

> **Caveat for WS4:** the pending "seamless pairing" (terminal scope + 30-day token + auto-arm replacing per-pane arming) directly trades against 3.3/3.4. Auto-arm by default re-introduces the reflexive-approval and stolen-phone blast-radius this theme warns about. This needs the threat-model the founder already owes (per memory: "Epic G remote threat-model owed") before it ships as a default.

---

## Theme 4 — Voice-first / hands-free / accessibility

Voice is not a nice-to-have here; it's the unlock for the phone-as-cockpit and a genuine accessibility story.

### 4.1 Voice steering is the modality voice is actually good at
**Severity: high (overlaps 2.1; this is the strategic framing).**
Humans speak 150+ WPM vs 40-80 typing. The "key insight that makes voice coding viable" is using voice to tell the AI _which code to write_, NOT dictating code. The official `/voice` mode is laptop-bound (hold spacebar) and doesn't bridge to the phone.
- Evidence: happy.engineering, addyo.substack.com, claude-code #29399. Accuracy tax (WhisperFlow ~80%) is recoverable in prose, fatal in code.
- Why it matters: GlaudeCode's surface (`conversationPage` natural-language conversation) is exactly the modality voice handles well, and putting it on the phone frees voice from the desk.
- Direction: phone-side voice on the conversation view; the agent absorbs imprecise transcription. **Effort: M** (same work as 2.1).

### 4.2 Accessibility — a no-keyboard path for RSI / motor impairment
**Severity: medium (real, underserved, good-faith positioning).**
RSI/motor-impaired developers can't type for long stretches; Talon/Cursorless are powerful but need a heavy desk rig and a month+ learning curve, with no good lid-closed / phone-from-bed path.
- Evidence: DEV (wrist pain ~80% reduced via voice), Talon creator left full-time work after hand pain, Blake Watson (SMA makes physical keyboards impossible).
- Why it matters: a phone cockpit needing zero desk rig and zero training is a genuinely accessible no-keyboard path, usable from bed on a bad-hands day.
- Direction: position as the low-activation-energy accessible _complement_ to Talon, not a competitor. The terminal mirror gives full-fidelity output, not a lossy re-render. **Effort: M** (rides on 4.1; mostly positioning + voice).

### 4.3 Capturing otherwise-dead time
**Severity: low-medium.**
The "think through a refactor while walking / between dinner and bed" workflow is blocked by being screen-tethered and by the laptop sleeping when you walk away.
- Evidence: happy.engineering ("three hours between dinner and bed currently produce zero code"), zackproser.com (walking-and-talking).
- Why it matters: this is the founder's own walk-around workflow.
- Direction: the agent runs on the user's own always-on Mac over Tailscale, so the phone is a thin window and the session survives walking away. Pairs with 2.6 (lid-closed) and 4.1 (voice). **Effort: S** (emergent once 2.6 + 4.1 land).

---

## Top 5 pains GlaudeCode is uniquely positioned to kill

Ranked by uniqueness-of-fit × severity. "Unique" means GlaudeCode's architecture answers it structurally where competitors cannot.

1. **Approval desync (1.1).** The terminal mirror surfaces the REAL prompt and the Rust-authoritative arming gate makes the phone's approval the host's input — there is no proxy to fall out of sync. This is the founder's stated motivation and Anthropic's worst-confirmed bug. _Effort: S (verify on device)._

2. **Code/session through a vendor relay (3.1).** Engine-serves-PWA over the user's own Tailscale, metadata-only audit, no token in URL — the clean structural answer to the #1 trust objection, and the exact thing Anthropic declined to build (#25746). _Effort: S (lead with it)._

3. **Can't recover a stuck/blocked session remotely (1.2, 2.7).** The raw-PTY channel can send Esc/Ctrl-C and any key; no host-only recovery surface exists. Pair with Web Push so you're pinged instead of babysitting. _Effort: S for recovery / M for push._

4. **Typing is unusable without voice (2.1 / 4.1).** The single most-requested mobile gap, and a perfect fit for the conversation surface + the founder's voice-first workflow. Currently NOT solved — the highest-value piece of net-new work. _Effort: M._

5. **Lid-closed / always-on host (2.6).** Owning the Rust core + persistent Bun sidecar decouples the session from a foreground terminal window; no cloud timeout because transport is the user's own Tailscale. Explicit founder requirement; genuinely hard, so even a "host will sleep" HUD diagnostic is a win. _Effort: M–L._

**Reality check:** of these five, #2 and (architecturally) #1/#3 are already true and need verification + messaging; #4 and #5 are real engineering still to do. The wedge is strong and evidence-backed, but the product is not yet proven on a device against these alternatives — that verification is the most valuable next step.
