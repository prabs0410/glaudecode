# GlaudeCode — Complete Build Record

> A full, honest record of everything built for GlaudeCode to date. Companion to the live
> status in [`state.md`](state.md) and the plan/backlog in [`GOAL.md`](../docs/GOAL.md). Commit
> hashes are given so any claim here is traceable to the code. Written 2026-06-11.

---

## 1. What GlaudeCode is

**A desktop terminal built to make Claude Code exceptional** — not a neutral "meta-layer," but the
terminal *designed for* Claude Code, competing on integration depth (the Cursor-vs-VSCode bet). You
live in it: it runs real shells **and** `claude` sessions, shows you what each agent is doing (state,
timeline, thinking, files, tokens, cost), lets you act on it (approve tool calls, steer, hand off),
orchestrates many sessions across git worktrees, remembers your work (search, memory, graph), and
reaches your sessions from a phone — all while staying an open, hackable, fast terminal.

**Positioning + architecture are locked** in ADR 0003/0004 and Constitution v2.0.0. Apache-2.0.

---

## 2. Architecture (the load-bearing shape)

Three layers, one rule:

```
┌──────────────────────────────────────────────────────────────┐
│ WebView (React 19 + TS + xterm.js WebGL)  — renders only      │
│   Sidebar · Workspace(tabs/split) · RightDock · StatusBar     │
│   talks to the engine over localhost HTTP/WS (engine.ts)      │
└───────────────▲───────────────────────────▲──────────────────┘
   Tauri invoke │ (PTY only)        HTTP/RPC │ Bearer token
┌───────────────┴───────────┐   ┌────────────┴──────────────────┐
│ Rust core (Tauri 2)        │   │ @glaudecode/engine (Bun)       │
│  • PtyRegistry (portable-  │   │  • ClaudeCodeAdapter = the ONE │
│    pty), pane-keyed PTYs    │  spawns│   point that touches Claude │
│  • spawns the engine sidecar├──────►│   Code (Agent SDK only)      │
│    reads {port,token}       │   │  • pure session-computation    │
│  • zsh ZDOTDIR wrapper      │   │    logic (tested) → RPC views  │
│  • Tauri plugins            │   │  • localhost server + remote   │
└─────────────────────────────┘   │    cockpit (Bun.serve HTTP/WS) │
                                   └────────────────────────────────┘
```

- **Constitution Principle XI:** *all* Claude Code access goes through `ClaudeCodeAdapter` using the
  Agent SDK — never raw `~/.claude` JSONL, never tight `listSessions()` polling. One file changes if
  Claude Code's interface changes.
- **Pure logic in the engine, rendering in the WebView:** parsers, state derivation, cost, conflict
  detection, policy, etc. live in `@glaudecode/engine` and are unit-tested there; the WebView calls
  RPC methods computed server-side and just draws. A handful of pure functions are *mirrored* in the
  bundle (filterSessions, fuzzy, keybindings, osc, notify) to avoid pulling the Node-only SDK in.
- **PTY in the Rust core** (perf): a `PtyRegistry` keyed by `paneId`; pane-scoped
  `pty_spawn/write/resize/kill`; namespaced `pty-output:{paneId}` / `pty-exit:{paneId}` events.
- **Engine = localhost HTTP server** (127.0.0.1, ephemeral port, per-launch bearer token), `POST
  /rpc {method, params}`. The same server is the basis for the remote cockpit (Epic G).
- **Spawn handshake:** the Rust core runs `bun packages/engine/bin/serve.ts`, reads `{port,token}`
  from stdout line 1, exposes it to the WebView via the `engine_endpoint` command.

Repo layout: `packages/engine` (host-agnostic TS lib + Bun server), `packages/desktop` (Tauri app:
`src/` React, `src-tauri/` Rust). Spec-Kit (`.specify/`) + ADRs + per-epic design docs under `docs/`.

---

## 3. Build phases — everything that shipped

Built design-doc-first + TDD, one item per commit, on stacked `feat/*` branches under the
autonomous-build guardrails (branch+PR, tests gate, prabs0410 identity, adapter rule, no "namesake"
work). **All commits attribute to `prabs0410`.**

### Phase 0 — Foundation (pre-V2, on `main`)
Positioning pivot + architecture lock (ADR 0003/0004, constitution v2.0.0) `050c58b`; Claude Code
integration spike verified `8e450b0`; working Tauri + xterm.js + PTY skeleton running real `claude`
`a3dae6d`.

### Phase 1 — V1: "see what Claude Code is doing" (6 features) — COMPLETE
`@glaudecode/engine` + `ClaudeCodeAdapter` `528801a` · localhost RPC server `81af26a` · sidecar
wiring `4a3791b` · **V1-1 sessions sidebar** (list/search/rename/tag/delete) `54c3c28` · **V1-2
agent-state status bar** (idle/thinking/running-tool + model + elapsed) `a8ff9a2` · **V1-3 tool-call
timeline + thinking panel** `48b46b6` · **V1-4 live token/cost counter** (estimate from a price
table) `3365e47` · **V1-5 persistent changes panel + tabbed right dock** `6c17979`.

### Phase 2 — V2: seven epics A–G — COMPLETE

**Epic A — Orchestration** (`feat/v2-a-orchestration`)
- A1 `WorktreeManager` — `git worktree` via arg-arrays; tested porcelain parser `ad0067a`
- A2 `ConflictDetector` — pure path-overlap detection + `conflicts` RPC `580afb2`
- A3 **multi-PTY registry (Rust)** — `PtyRegistry`, pane-scoped commands, namespaced events; `cmd`/
  `args` so a pane hosts the shell or `claude --session-id <uuid>` `ec533d9`
- A4 orchestration UI — worktree+conflicts RPC `fa95e71`; tabbed `Workspace` + "+ Claude" flow
  (create worktree → mint uuid → spawn `claude --session-id`) + per-pane dock binding + sidebar live
  dots `5be0aac`; non-blocking `ConflictBanner` `409805c`
- A5 **context handoff** — `buildHandoffSummary` pure digest + `handoff` RPC; UI pastes the digest
  into the target pane via bracketed paste (terminal-native; no live inter-session messaging) `3f0189c`

**Epic B — Extensibility** (`feat/v2-b-extensibility`)
- B1 typed lifecycle `EventBus` (ADR-0002 taxonomy; disposer; `*` wildcard; handler-failure
  isolation) `6c1442a`
- B2 jiti `ExtensionHost` — discovers `~/.glaudecode/extensions/*.ts` + repo-local, `register(api)`
  with on/registerCommand/log; failure-isolated; **trusted-only in-sidecar** (documented; Worker
  isolation is a pre-1.0 gate) `8a95568`
- B3 advisory rule-based `MetaAgent` (stuck/conflict/finished observations, **off by default, $0,
  never acts**) + `metaObservations` RPC + opt-in `MetaAgentPanel` `6223bf7` / `075e202`

**Epic C — Cost & control** (`feat/v2-c-cost-control`)
- C1 context-window gauge (`computeContextUsage` + status-bar `ctx NN%`, warns near compaction) `e4ac203`
- C2 **smart approval** — `classifyTool` policy (read-only auto-allow, risky→ask, catastrophic
  auto-deny) `cd23ec2` · reversible `ApprovalHookInstaller` for `.claude/settings.json` `898c8f0` ·
  `ApprovalQueue` + `/approval` endpoint + `bin/approval-hook.ts` (fail-closed dangerous / fail-open
  read-only when engine unreachable) `5c86103` · opt-in `ApprovalPanel` cards `cb3e47b`
- C3 budgets + cost rollups (`aggregateDayCosts`/`evaluateBudget` pure + `CostStore` + `budgetStatus`
  RPC + `BudgetChip`; desktop-notification alerts deferred to F) `ebd750a`
- C4 model suggestion (`suggestModel` cheap-mode heuristic + review-first Haiku chip) `e76d745`

**Epic D — Memory & knowledge** (`feat/v2-d-memory-knowledge`)
- D1 `parseLoadedContext` + `MemoryStore` (memory under `~/.claude/projects/<encoded>`; AGENTS.md/
  CLAUDE.md read/write **through the symlink**; path-traversal-safe) + Memory dock tab `0bd4347`
- D2 `mapGraphJson` + `GraphManager` (graphify subprocess, **optional — degrades** to an enable-guide
  if Python absent) + Graph dock tab `2326d34`
- D3 `SearchIndex` (SQLite **FTS5** with bm25/snippet, LIKE fallback, huge-session cap) + reindex/
  search RPCs (evict on delete) + sidebar `GlobalSearch` `6c4df75`

**Epic E — Session tooling** (`feat/v2-e-session-tooling`)
- E1 `GitManager` (porcelain + unified-diff parsers; status/diff/stage/commit/restore, real-repo
  tested) `78cf9f1`
- E2 `sessionChangesGit` RPC + git-aware changes panel (state badges, stage, commit, per-file diff)
  `374270f`
- E3 `buildHunkPatch`/`revertHunk` (reverse-patch, refuses on conflict) + per-hunk revert `514c996`
- E4 `compareSessions` pure + Compare tab (tools/files/cost diff) `57fde4b`
- E5 `buildResumeBriefing` + `ResumeBanner` (recap + suggested next) `383619f`
- E6 `redactText`/`buildReplayBundle` + Replay tab (export/import, best-effort redaction + warning)
  `294ca4d`
- E7 `BookmarkStore` (`~/.glaudecode/bookmarks`, prune on delete) + timeline stars `5d78f7c`

**Epic F — Terminal UX** (`feat/v2-f-terminal-ux`)
- F1 `fuzzyScore`/`fuzzyRank` + **Cmd-K `CommandPalette`** (commands + inline content search) `9bf4062`
- F2 keybindings (`normalizeKeys`/`mergeKeymap`/`detectConflicts`/`validateKeys`/`matchEvent` +
  `KeybindingStore`) + keymap-driven dispatch + rebind modal `b21bc73`
- F3 `extractVariables`/`fillTemplate` + `PromptStore` + `SlashCommandWriter` + `PromptsModal`
  (templated prompts → pane; build real `.claude/commands`) `50f668c`
- F4 `coalesceNotifications` + Tauri notification plugin + `NotificationService`
  (finished/approval/budget → OS notification + toast fallback, quiet mode) `7b52155`

**Epic G — Cockpit** (`feat/v2-g-cockpit`) — *security-critical; default stays localhost-only*
- G2 (security core) `PairingService` — single-use expiring **pair codes** → scoped (view/steer),
  expiring, revocable, in-memory **remote tokens** (no token at rest) + **fail-safe scope
  enforcement** in the RPC handler (reads=view, pairing=local, everything-else=steer) `9056535`
- G1 + G3/G4 — RemoteServer serves the cockpit at `/app` (PWA) + `/ws` token-authed live-approvals
  stream + unauthenticated `/pair` code redemption + `defaultDir`; remote bind is **explicit opt-in**
  (`hostname`), default 127.0.0.1. Dependency-free **mobile cockpit** (`cockpit.ts`): pair by code,
  view sessions, **answer approvals from a phone** (HTML-escaped + delegated handlers). Desktop
  `PairingModal` mints codes + lists/revokes devices `b17d7e8`

### Phase 3 — Post-V2 fixes (`feat/shell-autosuggestions`)
- **CORS** so the WebView (origin `localhost:1420` / `tauri://localhost`) can reach the engine
  (`127.0.0.1:<port>`) — this fixed "Load failed" on every panel `f3345b5`; then **pinned CORS to
  allowlisted WebView origins** (not `*`) `edeed39`
- Hardened the approval-hook install: **local-only** scope + **shell-quoted** paths `f031483`

### Phase 4 — Shell feel + layout (`feat/shell-autosuggestions`)
- **zsh command autosuggestions** (fish-style ghost text from history), injected **only into
  GlaudeCode shells** via a **ZDOTDIR wrapper** under `~/.glaudecode/shell` — sources the user's real
  `.zshenv/.zprofile/.zshrc`, then the plugin, then restores the real `ZDOTDIR`; **dotfiles never
  modified** `495dfee`
- **Smart Tab** — accept the suggestion if shown, else fall through to whatever Tab was bound to (fzf-
  tab etc. preserved) `6c0ab5b`
- **Resizable panels** with remembered widths (draggable dividers) `3e8204e`

### Phase 5 — V3: Terminal Polish & Feel (clusters A–E) — COMPLETE (`feat/v3-terminal-polish`)

| | What |
|---|---|
| **A1** `f056b8e` | Rename app `desktop` → **GlaudeCode** (productName + title; bigger default window) |
| **A2** `2277fd5` | Window title reflects active session/cwd (Tauri window API + capability) |
| **A3** `6d4e950` | Remember window size & position (`tauri-plugin-window-state`) |
| **A4** `9f5d9e8` | **App icon** — blue `›` chevron + green `_` on a dark rounded square (drawn w/ ImageMagick, `tauri icon`) |
| **B1** `7b58dd5` | Font zoom (Cmd ±/0), persisted, live across panes, rebindable |
| **B2** `8ce732c` | Clickable web links → system browser (web-links addon + opener) |
| **B3** `9b42d99` | In-terminal search (Cmd-F, search addon, next/prev) |
| **B4** `c16d790` | Copy/paste (Cmd-C selection, Cmd-V bracketed paste, optional copy-on-select) |
| **B5** `6183e55` | Cursor style (block/bar/underline) + blink toggle |
| **B6** `b7d9415` | Terminal themes incl. a **light mode** (3 schemes, host bg synced) |
| **B7** `5f1c606` | unicode11 emoji/wide-char width (ligatures deferred — WebGL incompat) |
| **B8** `9e51260` | Scrollback 5000 + visual bell |
| **C1** `fa0fd5e` | `fc -R` history safety net so suggestions always have data |
| **C2** `da6561f` | **zsh-syntax-highlighting** (vendored, green/red as you type) |
| **C3** `c08a2a3` | **Directory-scoped suggestions** (preexec records cmd+cwd; custom strategy prefers cwd) |
| **C4** `6b6f3f9` | Clickable file paths (open allowlisted types; else reveal — see security log) |
| **D1+D5** `3f89e5d` | Collapsible sidebar/dock (Cmd-B / Cmd-Shift-B, dbl-click divider) + **zen mode** |
| **D2** `6980850` | **Cmd-1..9** pane switching |
| **D3** `f471b2d` | Close-confirm for running Claude sessions |
| **D4** `55074cf` | Drag to reorder tabs |
| **E1** `57634f1` | **Split panes** (2-pane side-by-side, `mod+d`) — design note `v3-e1-split-panes.md` |
| **E2** `a9c9e7f` | **OSC 133/7 shell integration** → command duration + exit-code badges + live cwd — design note `v3-e2-shell-integration.md` |

Plus the cross-cutting fix `81b53df`: **keymap `mod` = Cmd on macOS / Ctrl elsewhere** — previously
`mod` matched Cmd *or* Ctrl, hijacking terminal Ctrl-keys (Ctrl-C/W/K/F); now Ctrl passes through.

### Phase 6 — Product correctness (`feat/v3-terminal-polish`)
- **Bind dock + status to the active pane only** `bda2ee3` — the dock no longer shows stale historical
  session data when you're in a plain shell. A Claude pane → its live session; a Shell pane → empty.
  Sidebar/search clicks **switch** to a live pane or **resume** the session (`claude --resume <id>`),
  never repurpose the dock. (This was a direct response to the "namesake / not functional" critique.)
- **Approval-hook stranding fix** `b7f3f30` / `9f947ae` / `25cfc01` — the smart-approval PreToolUse
  hook could fail-closed and deny *every* tool for *every* `claude` in the repo when the app was shut
  (it bricked the building agent). Now GlaudeCode-spawned PTYs set `GLAUDECODE_MANAGED=1` and the hook
  no-ops for any `claude` without it (only GlaudeCode-launched sessions are gated); the endpoint file
  refreshes on each launch; and it's written `0o600` / dir `0o700` (was world-readable with the bearer
  token). See memory `project-approval-hook-can-strand-agent`.

### Phase 7 — V4: dogfood quality pass "make every surface honest" (`feat/v4-quality-pass`) — COMPLETE
Audit-driven fixes after dogfooding (plan: `docs/GOAL-V4.md`). All on data the audit found genuinely
broken, one commit per cluster.
- **A — honest empty states + compare scope + resume timing** `21537bc` / `2f9345b` / `e6fc71d` —
  Graph/Memory/Compare/Replay no longer say "No project." on a shell pane; ComparePanel reads each
  session from its own cwd (was reading B from A's worktree); the resume recap now shows *before*
  resuming a stale session, not over an already-open one.
- **B — search scope + session sort + errors** `4392d2d` — FTS index gained a `dir` column so search is
  project-scoped (was cross-project, wrong-dir resume); sidebar sorts live-first then by recency;
  search/reindex errors surfaced instead of swallowed.
- **C — split panes + OSC-7 cwd** `47503a8` — split panes made actually resizable (Splitter between the
  panes via CSS `order`) + remembered width; the OSC-7 cwd surfaced as a chip.
- **D/E/F** `fce62ec` / `4e9201c` / `a9ffae8` — compare legend + consistent empty-state wording;
  robustness (keymap doesn't fire while typing; await WS listeners before spawn; "Use → pane" disabled
  on shell panes; copy-on-select on real mouseup); removed 5 orphaned RPC wrappers.
- **Crash fix** `c18053d` — the recency sort called `.localeCompare` on `lastModified`, which the SDK
  delivers as an epoch **number**, not the typed `string` → the sort threw and (with no boundary)
  blanked the whole app. Normalised to millis + added a top-level **ErrorBoundary** in `main.tsx`.

### Phase 8 — V5: phone-driven full terminal (`feat/v5-remote-terminal`) — Phase 0+1+2 BUILT + reviewed, on-device verify pending
The flagship: drive your whole terminal + Claude Code from your phone, secure-by-default, no cloud we
run. Researched first (5 design docs: `docs/design/{mobile-terminal-control,transport-options-phone-to-mac,
oss-at-scale-strategy,secure-mirror-tech-stack,cross-project-session-view}.md`); plan in `docs/GOAL-V5.md`.
- **Phase 0 — security footguns** `4c8202a` — `remote.enable()` refuses wildcard binds; `/ws` no longer
  takes the token in the URL or accepts the local bearer (paired token in the first message instead);
  `/pair` rate-limited + audited per IP; pair-code entropy widened 8→10. New pure `RateLimiter`.
- **Phase 1 — view-only mirror, engine side** — `termProtocol` (per-pane cockpit codec) `fc4e38b` ·
  `PaneHub` (ring-buffer replay + ACK flow control + fan-out) `85bfb48` · `bridgeProtocol` (multiplexed
  Rust↔engine codec) `5131d2a` · server wiring `c38db2e` (`/pane-bridge` **bearer-only**, `/term-ws`
  **paired-only**, `listPanes` view RPC). All unit-tested + an end-to-end test (bridge client → term
  client) proving the relay + auth boundary.
- **Phase 1 — Rust producer** `cbe85c4` — a sync `tungstenite` client (fits the blocking PTY reader
  threads, no async runtime) tees PTY output → engine over a bounded drop-on-full channel (local
  terminal never stalls). `pty_spawn` announces panes (META+SIZE) + tees output; reader sends CLOSE.
- **Phase 1 — cockpit consumer** `6961673` — engine vendors **xterm.js 6.0.0** (served itself, no CDN);
  `/app/term` view-only page attaches to `/term-ws`, decodes the protocol, ACKs consumed bytes; cockpit
  home gains a "Terminals" list (`listPanes`).
- **Verify-phase fixes** — a **corrupted window-state** restored the window off-screen (9768px at
  x=3280) — *not a crash*; reset it (and noted a follow-up to clamp restored geometry to the visible
  screen). Fixed a font-size-effect `pty_resize` racing the now-async spawn (added `.catch`). Added a
  bearer-gated `/clientlog` endpoint so WebView errors surface in the engine log (how the above was found).
- **Phase 2 — remote input (the RCE-class slice)** — phone keystrokes now reach the PTY, behind two
  default-OFF gates. Built bottom-up, each layer committed + green:
  - **Engine** `94b9a0b` — new `terminal` token scope on a linear ladder `view < steer < terminal`
    (terminal NEVER implied by steer; `requireScope`/`levelSatisfies` share one rank helper). INPUT op
    on the cockpit codec; INPUT (engine→Rust) + ARM (Rust→engine) ops on the bridge codec. `PaneHub`
    gains per-pane `armed` (default off) + `canInput`. `/term-ws` captures each token's scope and, on an
    INPUT frame, requires `scope===terminal` **and** an armed pane before relaying onto a new
    bearer-only **`/pane-input-bridge`**. Tests: terminal→armed relays; steer denied (scope);
    terminal→unarmed denied (arming); input-bridge rejects paired tokens (auth boundary).
  - **Rust** `8dc1788` — a second simplex `tungstenite` reader thread (`pane-input-bridge`) brings
    keystrokes back; `pty_write_internal` re-checks an **authoritative `armed` HashSet at the moment of
    PTY write** (a buggy/compromised engine still can't type into an unarmed pane) and emits
    `pane-remote-input:{paneId}`. `pty_set_armed` (mirrors arm state to the engine via ARM) +
    `pty_disarm_all` (kill switch). Arm state cleared on pane kill/exit.
  - **UI** `e8b5e7f` — per-tab 📱 arm toggle (dim/amber/green-pulse-while-driving), a "⛔ Disarm all"
    kill switch, a 3-way pairing scope picker (view/steer/terminal) with an explicit RCE warning; the
    phone terminal page gains an input bar (text box + Esc/Tab/^C/arrows key bar + raw-keystroke toggle)
    shown only for terminal scope, enabled only when the pane is armed (polled from `listPanes`).
  - **Security review** (mandatory; 4 adversarial lenses + a synthesizing lead, run as a workflow) —
    confirmed the core model sound (dual gate, default-off, bearer-only bridges, kill switch, first-
    message auth). One false positive (arm-cleanup already present). One **medium fixed** `4453638`: a
    live `/term-ws` cached only its scope, so a revoked/expired terminal token kept typing until the
    socket closed — now the token is **re-verified per keystroke** (immediate cut + close) and mirror
    sockets are **swept every 2s** against revocation/expiry. Deferred to the public-release track
    (Phase 3/7, not blockers for personal use): an RPC `TERMINAL_ONLY_METHODS` tier + a "every method
    classified" test, lifecycle audit logging, and fail-closed-on-input-bridge-reconnect.
- **Phase 4 — Mobile input UX (`feat/v5-mobile-ux`, me-first #1, autonomous `/goal` run of `docs/goal-v5/`)** —
  the phone goes from "watch + type a line" to genuinely thumb-drivable. Pure logic unit-tested in the
  engine; the phone page is a served string (behavioral verify = the real-device QA gate).
  - **4.1** `5e5da99`/`1be7c7f` — Mode A: a multi-line textarea with Send (text+Enter) vs Insert (no
    Enter), multi-line bracketed-pasted (`wrapForPaste`, tested); Message/Smart tabs with a **persistent**
    key bar (a deliberate deviation from a literal 3rd "Keys" tab — the design mandates the keys always be
    reachable); the hardcoded 118px offset becomes a measured `layout()`.
  - **4.2** `8f31c93` — Mode B: the bar pins above the soft keyboard (VisualViewport, feature-detected),
    taps don't dismiss the keyboard; sticky/chainable Ctrl (`ctrlByte`, tested), Shift-Tab, Enter, Ctrl-arrows.
  - **4.3** `ae04fa9`/`bd2c0f7` — Mode C: a new read-only `promptState` RPC (`derivePromptState`, tested)
    surfaces a live AskUserQuestion as tappable option buttons (down-arrow×i + Enter), plus chips
    (yes/continue/Esc) and one-tap PromptStore snippets. `permissionMode` omitted (not derivable from JSONL).
  - **4.4** `121e641` — multi-session steering: terminal rows show an `agentState` dot + a "needs you"
    badge (pending approval/question); the term socket detaches while backgrounded (ring-replay on return);
    a ⇄ switcher.
  - **4.5** `790e319` — resize authority: a phone "⤢ size" take-control toggle (default desktop-authoritative).
    New `RESIZE` ops (termProtocol 0x04, bridge 0x06) gated by a **shared `gateTerminal`** (identical to the
    INPUT gate) + a created `pty_resize_internal` (authoritative armed re-check); test proves a steer RESIZE
    is dropped. (4.5.2 real-device QA = HUMAN-GATE.)
- **Phase 5 — Transport & onboarding (`feat/v5-transport`, me-first #2)** — make the blessed remote path
  one-scan and installable.
  - **5.1** `0308459`/`18cc749` — Tailscale **Serve** as the default: a Rust serve lifecycle
    (`tailscale_serve_start/stop/status` + a single `run_tailscale` candidate-runner) proxies
    `https://<node>.ts.net:443` → the **localhost** engine, so the engine never opens a second listener
    (cleaner + more secure than binding the tailnet IP). The remote toggle prefers Serve, falls back to
    the plain bind; the cockpit manifest gains id/scope + an SVG icon + iOS standalone metas (installable).
  - **5.2** `d460f77` — QR onboarding: a QR (tiny MIT `qrcode-generator`) encodes `{url}#code=…` in the
    **fragment** (never logged); the cockpit auto-pairs from `#code=` (same `/pair` rate-limiter, no bypass).
  - **5.3** `070ee61` — keep-awake: a cross-platform, ref-counted `keep_awake.rs` (macOS `caffeinate`;
    Linux `systemd-inhibit` slots in at Phase 6/6.2) held while remote is on, released on toggle-off + exit.
  - **5.4** `99e0362` — `docs/design/transport-self-host-relay.md` (you-run-it recipe; plaintext-until-Phase-3)
    + `transport-acl-hardening.md` (deny-by-default tailnet grant, a MUST on shared tailnets); in-app ACL pointer.
- **Status:** Phases 0–2 + **4 + 5** built (engine **321 tests** green; `cargo check` + `tsc` + `vite
  build` clean). Outstanding HUMAN-GATEs: Phase 4 real iOS/Android QA; Phase-2 on-device verify; Phase 5
  needs a real tailnet (MagicDNS+certs for Serve, the PWA install, the ACL snippet on a shared tailnet).
  **Next in the me-first order: Phase 3 (app-layer E2E crypto).** Then Phase 6 (multi-OS), Phase 7
  (governance). **Public release** still gates on the Phase 3 independent crypto review + the Phase 7
  signing trust-root per `docs/goal-v5/README.md`. New `docs/design/*` files → INDEX lines flagged for the
  founder (`transport-self-host-relay.md`, `transport-acl-hardening.md`).

---

## 4. Security log (every finding addressed in-session)

The automated `security-guidance` review ran on commits throughout; each finding was fixed or
explicitly accepted:

1. **Handoff bracketed-paste breakout** (HIGH) → strip C0/C1 control bytes in `buildHandoffSummary`
   so a session's echoed content can't smuggle an end-paste escape `9d30b1a`.
2. **Approval-hook command injection / over-broad scope** (HIGH) → local-only methods + shell-quoted
   hook command `f031483`.
3. **Overly permissive CORS `*` on a bearer-authed service** (MEDIUM) → pin to allowlisted WebView
   origins `edeed39`.
4. **Clickable-path code execution** (HIGH) → a malicious process could print a path to an
   executable/script/bundle; clicking would launch it. Restricted `openPath` to a safe text/source/
   image/doc allowlist; everything else only **reveals** in Finder `9665831`.
5. **Cockpit XSS** (the cockpit holds a steer token) → HTML-escape all dynamic text incl. quotes +
   event-delegation (no inline-handler interpolation) — folded into `b17d7e8`.
6. **Approval-hook endpoint file world-readable** (held the bearer token) → `0o600`/`0o700` `25cfc01`.
7. **`GLAUDECODE_MANAGED=1` is spoofable** (HIGH, flagged) → **accepted** as a proportionate trade-off
   for a local single-user tool (spoofing needs local code execution, already past the trust boundary;
   the alternative stranded the building agent). Proper hardening (engine-issued nonce over IPC + PPID
   check) deferred to pre-1.0.
8. **Epic G remote surface** — owes a deliberate threat-model pass before the remote bind is ever
   enabled (default stays localhost-only). Recorded with a detailed threat model; memory
   `project-epic-g-remote-threat-model`.

---

## 5. Third-party vendored (attributed in `NOTICE`)
- **zsh-autosuggestions** v0.7.0 (MIT) — embedded via `include_str!`, written to `~/.glaudecode/shell`.
- **zsh-syntax-highlighting** v0.8.0 (BSD) — loader + main highlighter, same mechanism.
- Tauri plugins: `opener`, `notification`, `window-state`. JS: `@xterm/addon-{web-links,search,
  unicode11}`, `@tauri-apps/plugin-{opener,notification}`, `jiti`. SQLite via built-in `bun:sqlite`.

---

## 6. Quality & verification
- **Engine: 255/255 unit tests** across 36 files (pure logic — parsers, policy, cost, conflict,
  pairing scopes, OSC, fuzzy, keymap, budget, etc.). Run: `cd packages/engine && bun test`.
- **Typecheck clean**: engine + desktop (`tsc --noEmit`).
- **Builds green**: desktop `vite build`, Rust `cargo build`.
- Verified end-to-end where it matters: GitManager against a real temp repo; a paired steer token
  answering an approval over the real server; the ZDOTDIR wrapper generated correctly on a live spawn.
- UI items: typecheck + build + manual acceptance (consistent with how V1/V2 UI items were gated).

---

## 7. Branches, PRs, and how to land it
Work is committed **per-item on stacked branches** (each branches off the previous), so the tip
`feat/v3-terminal-polish` contains everything:

```
main → feat/v2-a-orchestration → …b…c…d…e…f → feat/v2-g-cockpit
     → feat/shell-autosuggestions → feat/v3-terminal-polish (tip, HEAD)
```

**Nothing is pushed** — per the founder's standing "wait." **PRs are blocked on `prabs0410` GitHub
auth**: `gh` is logged in as `ashinclude`; the founder must `gh auth login` as `prabs0410` before any
PR (commits already attribute correctly to prabs0410; the `origin` remote uses the `github-personal`
SSH alias). Landing options when ready: one PR per epic for reviewable history, or a single PR from
the tip. (Memory: `feedback-human-voice-prs-and-prabs0410-only`.)

---

## 8. Tracked, non-blocking deferrals (honest scope)
graphify needs Python (degrades gracefully) · SDK-`query` digests for meta-agent/resume are
cost-gated · full force-directed graph viz · FTS embeddings (FTS5 ships first) · full `packages/ui`
extraction + a real React web client (cockpit is dependency-free HTML for now) · EventBus **push**
stream replacing cockpit polling · terminal **pixel-mirroring** to mobile · ligatures (WebGL
incompat) · split-pane **ratio drag** + arbitrary tiling · bash/fish shell integration · OSC 7-exact
relative-path resolution is wired but bash lacks the hook · approval-hook auto-uninstall on quit ·
the Epic G threat-model pass and the `GLAUDECODE_MANAGED` nonce hardening (pre-1.0).

---

## 9. Key decisions & lessons (so they aren't relitigated)
- **Proceed in a crowded space** (Anthropic shipped a competing desktop app) on a differentiation bet
  — decided knowingly; differentiation is mandatory (memory `project-proceed-decision-crowded-space`).
- **Integration depth beats layer-above** — the product is the terminal *at* the layer, not a neutral
  orchestrator above it (memory `feedback-depth-of-integration-beats-layer-above`).
- **No namesake implementations** — design-doc-first + TDD; the "bind dock to active pane" fix is the
  clearest example of correcting always-on chrome that *looked* built-for-show even though the data
  was real.
- **Git identity is load-bearing** — every commit must stay `prabs0410`; never use `ashinclude`.
- Locked V2 calls: `claude --session-id` for deterministic binding; extensions trusted-only;
  approvals opt-in + fail-closed-dangerous/fail-open-readonly; graphify optional + FTS5-first;
  cockpit "view + steer" (pixel-mirroring deferred).

---

## 10. Where to look in the code
- Engine logic + RPC: `packages/engine/src/*.ts` (one module per concern; `rpc.ts` is the dispatcher
  + scope policy; `server.ts` the localhost/cockpit server; `bin/serve.ts` the sidecar entry).
- Rust core: `packages/desktop/src-tauri/src/lib.rs` (PTY registry, engine spawn, ZDOTDIR wrapper).
- WebView: `packages/desktop/src/*.tsx` (App orchestrates; TerminalPane = one xterm⇄PTY; RightDock
  tabs; the modals/panels; `engine.ts` is the RPC client).
- Cockpit: `packages/engine/src/cockpit.ts` (served at `/app`).
- Plan/status/design: `docs/GOAL.md`, `docs/state.md`, `docs/design/`, `docs/adr/`, this file.
