# Mobile Cockpit UX — Deep Research & Direction (2026-06-17)

> Research-backed brainstorm for redesigning the phone cockpit UX. Source: an 8-agent research
> workflow (5 reference-app digs + our-code diagnosis + synthesis + adversarial critique). Triggered
> by real-device screenshots showing horizontal cutoff, broken touch-scroll (pull-to-refresh), and a
> cramped "desktop terminal squeezed onto a phone" feel. Stack: a single served HTML page
> (`packages/engine/src/termPage.ts`) with vendored xterm.js, over the engine's `/term-ws` bridge.

## The observed problems

1. **Horizontal cutoff** — xterm renders at the Mac's column count (e.g. 120) verbatim; the phone fits ~45, so lines crop on the right. No FitAddon; the only fit path is a manual, armed-gated "⤢ size" chip using guessed cell metrics (`(13*0.6)`).
2. **Scroll hijacked** — drag up/down triggers Chrome pull-to-refresh / overscroll (page reloads) instead of scrolling scrollback. No `overscroll-behavior`/`touch-action`; a redundant nested scroll container.
3. **Cramped / not phone-native** — tiny 13px monospace, horizontal overflow, a 12-button horizontal-scroll key wall + Message|Smart tabs + textarea + Insert/Send, all stacked. A VT100 grid imported onto a screen that wants reflowing text and taps.

## The single most important finding (corrects a wrong assumption)

The Claude-native structured surface **does NOT require parsing ANSI/TUI bytes.** The `/term-ws` mirror is the only ANSI path. The engine already has a *separate, typed* data path: `adapter.getSessionMessages()` (Agent SDK → persisted JSONL → typed `text`/`thinking`/`tool_use`/`tool_result` blocks in `mappers.ts`/`types.ts`). `promptState.ts`, `agentState.ts`, `changes.ts`, and cost **already consume those typed blocks**. So a conversation/chat cockpit is **~80% built** and adds no ANSI parsing — it's far closer than it looks. The real gating risks for the full conversation view are JSONL **freshness/poll latency** (3s polling today) and the **worktree `paneId===sessionId`** identity bug — not parseability.

## Table-stakes fixes (must land first, any direction — days)

| # | Problem | Fix | Effort |
|---|---|---|---|
| 1 | Scroll hijacked | `overscroll-behavior:none` on html/body; `#term { overscroll-behavior:contain; touch-action:pan-y; overflow-x:hidden }`; drop the redundant outer scroller so xterm's `.xterm-viewport` owns scroll; inject `.xterm-viewport{overscroll-behavior:contain}`. ~4 CSS lines. | S |
| 2 | Horizontal cutoff | Vendor `@xterm/addon-fit` (~3KB) + serve it like `XTERM_JS`; `fit.fit()` after `term.open()` and on every layout/visualViewport/orientation change; **fit-by-default for ALL scopes** (ungate from `canTypeScope`/`sizeOn`/`armed`). | M |
| 3 | Soft-keyboard handling | `interactive-widget=resizes-content` (Android) + `100dvh` flex layout; keep the VisualViewport `translateY` path feature-gated for iOS/WebKit; call `fit.fit()` on keyboard open/close; wire it for ALL scopes. | M |
| 4 | Tiny text, no escape hatch | Default fontSize 15–16; `#tin` ≥16px (kills iOS focus auto-zoom); A−/A+ controls that re-fit; persist in **localStorage** (survives PWA cold-start). | S |

## Three design directions

**A — Faithful terminal, done right (L).** Keep the xterm mirror; make it a first-class mobile citizen: auto-fit, native touch-scroll, sticky modifiers (tap Ctrl then key — kills the ^C/^Z chips), a floating control puck (Steam Link / MS Remote Desktop pattern) instead of the chip wall, pinch-to-font-size, space-drag trackpad for arrows (Termius). *Pro:* zero protocol change, handles 100% of content (vim/htop/raw ANSI). *Con:* a 45-col grid on a phone is inherently a compromise; the highest-frequency action (answering a prompt) still routes through fragile cursor sequences.

**B — Claude-native conversation cockpit (XL).** Stop mirroring bytes for Claude panes. Render the typed session as a reflowing chat: text bubbles, collapsed tool-call cards, native unified-diff cards, a live status chip, and a pinned tap-to-answer AskUserQuestion card. Terminal becomes an explicit fallback. *Pro:* structurally eliminates all three bugs (reflow + native scroll); matches the whole field (Anthropic Remote Control, Cursor, Codex, Copilot, Devin); lighter over Tailscale; the real "tap me on the shoulder" job-to-be-done. *Con:* largest build; must keep the terminal escape hatch for TUIs; leans on session-identity + JSONL freshness.

**C — Hybrid: terminal canvas + floating agent layer (L).** The fixed-up terminal as the canvas, with a thin Claude-aware layer on top: a pinned answer card when waiting, a status chip when running, a composer, and an Agent/Terminal mode toggle. Ships the agent-native win (already ~80% built via `promptState`/`agentState`/`renderSmartQ`) **without** committing to the full re-render. *Pro:* best risk-adjusted payoff; reuses everything; keeps full terminal fidelity; a fork-in-the-road toward B. *Con:* two overlapping surfaces on a ~45-col phone is a real layout-budget problem; mode-toggle discoverability tax.

## Recommendation (synthesis + critique corrections)

**Table-stakes now → Direction C → evolve to B**, with two B-items pulled forward into C because they're cheaper than they look:

- **Unified-diff card in C, not "later."** `gitDiff`/`sessionChangesGit` + a tested `parseUnifiedDiff` already exist **and are already `VIEW_METHODS`** (`rpc.ts`, `gitManager.ts`). The marquee differentiator (native mobile diffs — the gap Anthropic's Remote Control leaves open) is a view-scoped RPC + a render, not a project.
- **Event-push over the existing `/ws` stream**, not 3s polling — beats both polling jank and deferred Web Push for the first cut of "tap me on the shoulder."

**Critical corrections to fold in:**
1. **Flip the sizing default to render-only fit on the phone** (no upstream SIGWINCH). Auto-reflowing the *live Mac PTY* while you may be sitting at the Mac is a footgun (and two clients can fight over size). True reflow = explicit opt-in while armed.
2. **Harden tap-to-answer before promoting it.** It currently sends `down-arrow × index + Enter` assuming the TUI highlight starts at row 0 — wrong for any pre-selected default, silently confirming the wrong option. Make the engine report the live highlighted index / accept an absolute "select option N" intent. Same fix makes multiSelect trustworthy.
3. **Discipline the two-surface layout.** Define what's visible *simultaneously* on a 360px viewport with the keyboard up — not just what exists.
4. **`localStorage`, not `sessionStorage`**, for prefs (survives mobile tab eviction).

## Open questions for the founder

1. **Sizing:** render-only fit on phone (safe, recommended) vs true reflow of the live Mac PTY (best phone result, reshapes your desktop pane while armed)?
2. **The real mobile job-to-be-done:** supervise + approve + answer (→ lean Claude-native, cut terminal polish) vs actually operate a terminal (→ invest in A's gestures/keys)?
3. **Remote surface:** C needs **no new RPC** (everything is already view/steer-scoped, per the critique) — so the structured layer does *not* widen the Epic-G remote threat-model surface. Only B's streaming/Web-Push would. Confirm we keep C inside the existing surface.
4. **Push:** in-PWA badge + `/ws` event-push first (no new remote channel) vs real Web Push (service worker + VAPID/APNs — new surface) later?
5. **Worktree session-identity bug** (`paneId===sessionId` fails for a different-cwd worktree): fix now (gates structured reliability) or scope V5 mobile to single-cwd and flag worktrees unsupported?
6. **Voice dictation** for prompt composing (Web Speech) — first cut or later? (Arguably higher-leverage than half the terminal polish if the JTBD is "compose prompts away from the desk.")
7. **Tablet vs phone:** the FitAddon fix gives a free iPad win (full-width fitted terminal is genuinely usable) — branch by device width, or optimize purely for the phone?

## Reference patterns worth stealing (from the 5-category dig)

- **Docked, grouped, customizable extra-keys row** pinned to the keyboard's top edge with overflow behind an expander (Termius/JuiceSSH/Blink) — not a free-floating chip wall.
- **Sticky modifiers** (tap Ctrl, then a key; visible armed state) — Termux/Blink. Replaces every ^C/^Z chip.
- **Space-drag / long-press trackpad** for arrows (Termius removed arrow buttons entirely).
- **Pinch = font-size + refit** (Blink/JuiceSSH), intercepted in JS (not page zoom).
- **Floating control puck / auto-minimizing toolbar** with a permanent red Interrupt (Steam Link, MS Remote Desktop, RealVNC, Moshi).
- **Fit-to-screen vs pan-and-zoom modes** (RDP/VNC) — the founder's "adaptive size."
- **Conversation/control-surface over a mirror** + tap-to-approve + grouped explained diffs (Anthropic Remote Control, Cursor, Codex, Copilot, Devin).
- **Anti-patterns:** shrinking a desktop terminal unchanged; a wall of chips; hardcoded cell-width guesses; `user-scalable=no` with no font control offered in return.

_Full agent output (ephemeral) was in the workflow run `wf_9eef8f90-67d`._
