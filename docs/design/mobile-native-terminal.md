# Mobile-Native Terminal — V6 Phase 1 design

> **Status:** design-doc-first (authored before the autonomous loop runs Phase 1). New doc; the V5
> analogue is [`epic-g-cockpit.md`](epic-g-cockpit.md) (which deliberately scoped mobile to "view +
> steer, terminal pixel-mirroring deferred"). V6 reverses that: the **raw terminal mirror is now the
> trusted core**, and this phase makes it genuinely mobile-native. A conversation view is a later
> upgrade-on-top (`conversation-view.md`, Phase 6 — out of scope here).
> **Surface:** the single served page `packages/engine/src/termPage.ts` (vendored xterm.js over
> `/term-ws`). **Reuses** the locked research: [`mobile-cockpit-ux-2026-06-17.md`](../research/mobile-cockpit-ux-2026-06-17.md)
> (table-stakes + reference patterns) and [`mobile-platform-transport-clipboard-2026-06-17.md`](../research/mobile-platform-transport-clipboard-2026-06-17.md)
> (resize-authority / lid-closed direction). Plan of record: `~/.claude/plans/resilient-singing-jellyfish.md` §"Phase 1".

## 0. Phase-0 prerequisites (already landed — verify, don't re-do)

This phase assumes the two P0 enablers are in place. Both are confirmed in the live tree:

- **P0a (`question` NotificationKind)** — present at `packages/engine/src/notify.ts:8`
  (`"finished" | "approval" | "error" | "budget" | "question"`). Used by Phase 3, not Phase 1; noted
  so the loop does not re-add it.
- **P0b (vendored FitAddon)** — `@xterm/addon-fit` is bundled to `packages/engine/vendor/addon-fit.js`,
  read at `server.ts:41` (`ADDON_FIT_JS = readVendor("addon-fit.js")`), served at `server.ts:438-441`
  (`GET /app/addon-fit.js`, UMD exposing `globalThis.FitAddon.FitAddon`), and the
  `<script src="/app/addon-fit.js">` is **already injected** at `termPage.ts:117` (after xterm.js,
  before the IIFE). So the addon is loadable in the page today — task 1.2 only has to *use* it and
  delete the guessed-metrics path.

---

## 1. Problem & user value

V5 proved you can drive the Mac's terminal + Claude Code from the phone, and the mirror is now reliable
(the respawn-orphan blank bug was root-caused on `fix/v5-audit`). But the phone experience is **not
usable**. Real-device screenshots and `termPage.ts` itself show three concrete defects
(`mobile-cockpit-ux-2026-06-17.md` §"observed problems"):

1. **Horizontal cutoff** — xterm renders at the Mac's column count (e.g. 120); the phone fits ~45, so
   every line crops on the right. The only fit path is a manual, armed-gated "⤢ size" chip using
   guessed cell metrics `13 * 0.6` / `13 * 1.3` (`termPage.ts:379-394`).
2. **Scroll hijacked** — a drag fires Chrome pull-to-refresh / overscroll (the page *reloads*) instead
   of scrolling scrollback. `#term` has `overflow: auto` with no `overscroll-behavior`/`touch-action`
   (`termPage.ts:32`), and it nests a redundant scroller around xterm's own `.xterm-viewport`.
3. **Cramped / not phone-native** — 13px monospace (`fontSize: 13`, `termPage.ts:133`), a 12-button
   horizontal-scroll key wall (`#keys`, `termPage.ts:99-112`), `Message|Smart` tabs, a textarea, and
   Insert/Send all stacked. A VT100 grid squeezed onto a screen that wants thumbs and reflow.

**User value (the V6 job-to-be-done):** the founder's Mac built-in display is dead → "away" = lid
closed, on charger, network-reachable. They want to do *everything* from the phone — a readable,
scrollable, fit-to-width terminal with a thumb-friendly key surface and voice-paste — replacing the
company-account-bound built-in remote control. Phase 1 makes the *trusted core* (the raw mirror that
shows every Claude approval/prompt/TUI variation natively — the exact thing the built-in remote
control fails at) genuinely usable on a phone. **Felt-improvement filter (Constitution II):** every
sub-task below is a defect a real thumb hits in the first 30 seconds.

## 2. Research (reuse — do not re-derive)

- **Table-stakes fixes** (`mobile-cockpit-ux-2026-06-17.md` §"Table-stakes"): exact CSS for
  scroll (`overscroll-behavior`/`touch-action`, drop the nested scroller, `.xterm-viewport` rule),
  FitAddon fit-by-default for **all scopes** (ungate from `canTypeScope`/`sizeOn`/`armed`),
  `interactive-widget=resizes-content` + `100dvh` + the iOS VisualViewport path, default fontSize
  15–16 / `#tin` ≥16px / A−/A+ in **localStorage** (survives PWA cold-start).
- **Reference patterns** (same doc, §"Reference patterns worth stealing"): docked grouped extra-keys
  row with an overflow expander (Termius/JuiceSSH/Blink); **sticky modifiers** (tap Ctrl then a key,
  visible armed state — Termux/Blink) replacing every `^C`/`^Z` chip; pinch = font-size + refit;
  fit-to-screen vs pan-and-zoom modes (RDP/VNC). Anti-patterns: shrinking a desktop terminal
  unchanged, a wall of chips, hardcoded cell-width guesses, `user-scalable=no` with no font control.
- **Sizing-default correction** (same doc, §"Recommendation", correction 1): **render-only fit on the
  phone**; true reflow of the live Mac PTY (a SIGWINCH that reshapes the desktop pane) is an explicit,
  authority-gated opt-in — two clients must never fight over size. This is the basis for §1.7.
- **Resize authority / lid-closed** (`mobile-platform-transport-clipboard-2026-06-17.md` §"Hard gates",
  last bullet): resize authority is already built (desktop-authoritative + take-control,
  `termPage.ts:511`); V6 adds a **lid-closed auto-grant** — when no desktop viewer is present (lid
  shut, dead built-in display) the phone owns cols/rows; revert to desktop-authoritative at the desk.
- **Pure-PWA lock** (same doc, §"Platform"): no native render path — `termPage.ts` is the single
  rendered artifact forever; everything here is plain web in any WebView.

## 3. Architecture (concrete: files, flow, reuse)

**Single edited file for 1.1–1.6:** `packages/engine/src/termPage.ts` (the `TERM_HTML` string +
inline IIFE). It is a self-contained HTML string the WebView cannot import from, so the two engine
helpers it depends on are **mirrored verbatim** and unit-tested in `packages/engine/src/termInput.ts`
(`ctrlByte`, `wrapForPaste`) — change both places if either changes (the established mirror rule,
`AGENTS.md` §"Build, test & gotchas"). 1.7 additionally touches the engine RPC layer
(`packages/engine/src/rpc.ts`), the `/term-ws` RESIZE gate (`packages/engine/src/server.ts:382-388`),
and a Rust display-power hook (`packages/desktop/src-tauri/src/lib.rs`).

**Control/data flow (unchanged transport):** Rust core owns the PTY → bridges OUTPUT/SIZE frames to
the engine `paneHub` → engine relays to the phone over `/term-ws` (binary `termProtocol`: `0x00`
OUTPUT, `0x01` SIZE, `0x02` ACK, `0x03` INPUT, `0x04` RESIZE). The phone renders in xterm and sends
ACK/INPUT/RESIZE back. **Phase 1 changes only the phone-side rendering + the RESIZE authority gate; no
new transport, no new frame.** (One new LOCAL-ONLY RPC + one new gate function — §4.)

### 1.1 Touch-scroll (S) — anchor `termPage.ts:32`

Drop the nested scroller and let xterm's own `.xterm-viewport` own scrolling. CSS only:

- `html, body { overscroll-behavior: none }` (kills pull-to-refresh on the page).
- `#term`: remove `overflow: auto`; set `overscroll-behavior: contain; touch-action: pan-y;
  overflow-x: hidden`. xterm fills `#term` and scrolls internally.
- Inject `.xterm-viewport { overscroll-behavior: contain; }` into the `<style>` block (xterm's own
  scroll container, so a fling at the top/bottom doesn't chain to the page).

Reuse: nothing new — pure CSS on the existing element. `[DEVICE-GATE]` pull-down does **not** reload.

### 1.2 Fit-to-width via FitAddon (M) — retire `termPage.ts:379-394`

Use the P0b-vendored addon (`globalThis.FitAddon.FitAddon`, served at `/app/addon-fit.js`). After
`term.open(...)` (`termPage.ts:136`):

```js
var fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);
function fit() { try { fitAddon.fit(); } catch (e) {} }
```

Call `fit()` after open, on `window.resize`, `visualViewport` resize/scroll, and `orientationchange`
(debounced, ~50ms). **Fit-by-default for ALL scopes** — move `fit()` *out* of the `if (canTypeScope)`
block (`termPage.ts:338`) so a view/steer phone also fits; it has no dependence on `armed`/`sizeOn`.

**Retire the guessed-metrics path:** delete `fitAndSend()`'s `cols = …/(13*0.6)` / `rows = …/(13*1.3)`
math (`termPage.ts:383-384`). FitAddon now computes cols/rows from real glyph metrics. The
`fit.fit()` call resizes the *local* xterm grid (render-only). Whether that local fit also emits a
RESIZE frame upstream is the §1.7 authority decision — **render-only fit never sends RESIZE** unless
authority is granted. This corrects `mobile-cockpit-ux` correction 1 (no unconditional SIGWINCH).

Reuse: vendored FitAddon (P0b). Delete: the manual cell-metric math.

### 1.3 Soft-keyboard (M) — anchors `termPage.ts:16`, `:32-36`, `:413-423`

- **Viewport meta** (`termPage.ts:16`): append `interactive-widget=resizes-content` so Android resizes
  the layout viewport when the keyboard opens (xterm's flex box shrinks, the key bar stays visible).
  Also **drop `maximum-scale=1, user-scalable=no`** (research anti-pattern) now that A−/A+ provides a
  real font escape hatch (§1.4).
- **`100dvh` flex layout:** convert `body` to a column flex (`height: 100dvh`); `#term` is `flex: 1`;
  `#inputbar` is the non-growing footer. This replaces the absolute `#term { top:38px; bottom:0 }`
  (`termPage.ts:32`) + the JS `layout()` bottom-offset hack (`termPage.ts:282-285`), which `dvh` +
  flex make unnecessary on Android.
- **iOS path (feature-gated):** Safari ignores `interactive-widget`, so **keep** the existing
  `visualViewport` `translateY` pin for the input bar (`termPage.ts:413-423`) behind a feature gate
  (`if (window.visualViewport && !supportsInteractiveWidget)`), and call `fit()` on keyboard
  open/close (the `pin()` handler already fires on `vv` resize/scroll — replace its `fitAndSend()`
  call with the new render-only `fit()`).
- Wire all of the above for **all scopes** (the keyboard appears for terminal scope; the fit-on-resize
  must run for view too).

Reuse: the existing VisualViewport `pin`/`kbHeight` machinery (`termPage.ts:276-279, 413-423`), now
calling render-only `fit()`. `[DEVICE-GATE]` the key bar is not covered by the keyboard.

### 1.4 Readable font (S) — anchors `termPage.ts:133`, `:65-67`

- Default `fontSize: 15` (or 16) in the `Terminal({...})` ctor (`termPage.ts:133`).
- `#tin` (the textarea, `termPage.ts:66`) font ≥16px — below 16px iOS auto-zooms on focus.
- **A− / A+ controls:** two small buttons (in `#bar` or a thin font row) that step `term.options.fontSize`
  by ±1 (clamp ~11–24), call `fit()` after, and persist to **`localStorage`** (`ck.fontSize`) — read
  on init. localStorage, not sessionStorage, so it survives a PWA cold-start
  (`mobile-cockpit-ux` correction 4). Optional stretch: pinch-to-font-size (intercept the gesture in
  JS, not page zoom) — defer unless cheap.

Reuse: nothing new. **Note the storage split:** prefs (font) → `localStorage`; the pairing token/scope
stay in `sessionStorage` (`termPage.ts:120-121`) by design (don't persist a token to disk).

### 1.5 Sticky-Ctrl key bar + Claude quick-insert chips (M) — anchors `termPage.ts:99-112`, `:163-178`, `:357-369`

Collapse the 12-chip horizontal wall (`termPage.ts:99-112`) to a compact, thumb-reachable set:

- **Primary row (always visible):** `Esc · Tab · ⇧Tab · ↑ ↓ ← → · ⏎ · Ctrl(sticky) · PgUp · PgDn`.
- **Sticky Ctrl** already exists (`k-ctrl`, `termPage.ts:104, 363`) and composes via `ctrlByte`
  (`termPage.ts:163-178`, mirrored from `termInput.ctrlByte`): tap Ctrl (it lights `.on`), the next
  key becomes its control byte, then it auto-releases. This **subsumes** the explicit `^C` chip
  (`k-ctrlc`) and covers `^C/^D/^R/^L/^A/^E/^U/^K/^W/^Z` with one button — delete the standalone `^C`
  chip and rely on `Ctrl` then `C`. (Keep a single `^C` only if QA shows the most-frequent interrupt
  needs one tap.) **Reuse `ctrlByte` — do not add new control logic.**
- **PgUp/PgDn:** new `tapKey("\x1b[5~")` / `tapKey("\x1b[6~")` buttons (the `tapKey` helper exists,
  `termPage.ts:357`).
- **Claude-Code quick-insert chips `/ @ # !`:** four insert chips (Smart tab or an inline row) that
  *insert* (no auto-Enter) the literal `/` (slash command), `@` (file ref), `#` (memory add), `!`
  (bash mode) into the composer/pane via `sendText` — the leading chars Claude Code's prompt treats
  specially. These are inserts, not sends (review-then-run discipline, mirrors the snippet path
  `termPage.ts:438-450`).
- Optional: tuck low-frequency keys behind an overflow expander (Termius pattern) if the row still
  overflows at 360px.

Reuse: `ctrlByte` (`termInput.ts:28` mirror at `termPage.ts:163`), `tapKey`, `sendText`,
`wrapForPaste`. No engine change.

### 1.6 Multi-session switch (M) — anchors `termPage.ts:526-535`, `rpc.ts:641`

Today switching is a single `⇄` "next terminal" cycle (`termPage.ts:526-535`) over `listPanes`. For
~4–5 sessions, replace the blind cycle with a **usable session list/switcher** that flags which pane
needs attention:

- A tap-target (the existing `⇄` or a sheet) opens a list of panes from `listPanes`
  (`rpc.ts:641` → `paneHub.list()`, returns `PaneInfo[]` with `paneId`, `title`, `armed`,
  `paneHub.ts:51-57`). Render `title` (8-char fallback as today, `termPage.ts:124`) + an attention dot.
- **Attention flag:** reuse the typed `agentState` RPC (VIEW scope, `rpc.ts:187`) per pane — a pane
  whose `agentState` is `waiting`/`needs-input` (an approval or AskUserQuestion pending) gets a dot;
  combine with `armed` to show "armed & waiting". `agentState`/`promptState` are already polled
  (`termPage.ts:452`); extend the poll to drive the switcher badge. Keep it cheap (the existing 3s
  interval; do not add tight polling — Principle XI).

Reuse: `listPanes` (already VIEW-scoped, `rpc.ts:192`), `agentState`/`promptState` (already polled).
No new RPC. `[DEVICE-GATE]` the switcher shows all ~4–5 panes and flags the one waiting.

### 1.7 Resize authority (split: 1.7a automatable, 1.7b device-gate, dedicated `gateResize`)

The render-only fit (§1.2) is always safe. Sending a **RESIZE** frame (`0x04`) is RCE-adjacent — it
reshapes the live desktop pane and two clients can fight over size — so it is granted only under
authority. Authority = the phone may own cols/rows **only when** input is granted (terminal scope +
token + armed) **AND** the desktop is effectively absent (lid closed OR no desktop viewer sustained
past a grace window). At the desk, the desktop is authoritative and the phone's RESIZE is rejected.

**1.7a — automatable lid-closed / no-desktop-viewer detection (Verify: unit-test + build).**

- **Rust display-power hook** (`packages/desktop/src-tauri/src/lib.rs`): a `lid_closed()` Tauri
  command that reports whether the built-in display is asleep/clamshell (macOS: query active displays
  / `CGDisplayIsActive` for the built-in, or observe the display-sleep notification). This sits beside
  the existing power machinery (`keep_awake.rs`, `set_keep_awake` at `lib.rs:946`; the Serve teardown
  + `caffeinate` release on exit at `lib.rs:1038-1039`). Behavioral confirmation of the OS call is a
  `[DEVICE-GATE]` (a CI runner has no lid); the command + its wiring are unit/build-verifiable.
- **Engine `LOCAL_ONLY` `lidClosed()` RPC** (`rpc.ts`): new method in the `RpcMethod` union
  (`rpc.ts:44-111`) + `METHODS` set (`rpc.ts:113-181`) + a dispatch case + add to `LOCAL_ONLY_METHODS`
  (`rpc.ts:206-223`) so a paired *remote* device can never read or assert the Mac's physical state —
  only the desktop bearer (which forwards the Rust hook's value). Per `AGENTS.md` "New engine RPC"
  checklist: also a `desktop/src/engine.ts` client wrapper + export from `index.ts`.
- **"No desktop viewer" definition:** no authenticated **steer-or-higher** desktop socket has been
  connected for a sustained **>30s grace** (configurable). The desktop is `"local"` scope on `/ws`;
  track the last-seen timestamp of a local/steer+ socket and treat absence-past-grace as "viewer
  gone". This is engine-side bookkeeping over the existing socket set (`sockets` in `server.ts`),
  unit-testable with a fake clock.
- **Audit every authority transition** (granted↔revoked, with the trigger: lid-closed / viewer-gone /
  viewer-returned) to the existing content-free `AuditLog` (`server.ts:134`), so an incident review can
  see when the phone held size authority. Reuses the audit taxonomy; add an `authority` event type.

**1.7b — `[DEVICE-GATE]` behavior.** The phone owns cols/rows **only when** granted (terminal + token
+ armed) **AND** (desktop absent >grace **OR** lid closed); it reverts to desktop-authoritative the
moment a desktop steer+ socket reappears or the lid opens. On revert, the engine resumes forwarding the
desktop's SIZE (`0x01`) and the phone stops asserting (the existing `if (!sizeOn …) term.resize(...)`
SIZE handler at `termPage.ts:508-513` is the revert path; `sizeOn` becomes "authority held" rather than
a manual toggle).

**`gateResize` (dedicated — NOT `gateTerminal`).** Today INPUT and RESIZE share `gateTerminal`
(`server.ts:140-155`, both call it at `:369` and `:385`). Split RESIZE onto its own
**`gateResize(ws)`**: it must satisfy *everything* `gateTerminal` checks (scope === "terminal",
token still verifies, pane armed) **AND** the authority state (lid closed OR no desktop viewer
>grace). INPUT keeps using `gateTerminal` unchanged — a phone may *type* into an armed pane while at
the desk; it may not *resize* it. The RESIZE branch (`server.ts:382-388`) calls `gateResize` instead of
`gateTerminal`; rate-limit + `clampDim` (1..1000) stay as-is.

**CI assert (machine-verifiable):** RESIZE is **rejected** when a desktop steer+ socket is active or
the lid is open; **accepted** only when terminal-scope + armed + authority-held. INPUT is unaffected by
authority. This is a pure unit test against `gateResize` with a fake socket-set + fake `lidClosed`.

Reuse: `gateTerminal` structure (`server.ts:140`), the `0x04` RESIZE branch (`server.ts:382-388`),
`clampDim`, the SIZE-revert path (`termPage.ts:508-513`), the AuditLog (`server.ts:134`), `keep_awake.rs`
neighbors. New: `lidClosed()` RPC, `gateResize`, the viewer-presence tracker, the `authority` audit
event.

## 4. Data model / protocol (new surface)

**No new WS frame** — RESIZE (`0x04`) already exists (`server.ts:382-388`). Phase 1 adds:

| New item | Where | Scope / shape |
|---|---|---|
| `lidClosed` RPC | `rpc.ts` union + `METHODS` + dispatch + `LOCAL_ONLY_METHODS`; `desktop/src/engine.ts` wrapper; `index.ts` export | `LOCAL_ONLY` → desktop bearer only. `() → { lidClosed: boolean }` (desktop forwards the Rust hook). |
| `lid_closed` Tauri command | `lib.rs` (beside `set_keep_awake`) | `() → bool`. macOS built-in-display active/asleep query. |
| `gateResize(ws)` | `server.ts` (new fn beside `gateTerminal:140`) | returns `paneId | null`; checks terminal scope + token + armed **AND** authority. |
| viewer-presence tracker | `server.ts` (over the `sockets` set) | last-seen ts of a local/steer+ socket; "viewer gone" = none for >30s grace (configurable). |
| `authority` audit event | `AuditLog` taxonomy (`server.ts:134`) | content-free: `{ type: "authority", state: "granted"|"revoked", trigger: "lid"|"viewer-gone"|"viewer-return" }`. |
| `ck.fontSize` localStorage key | `termPage.ts` | number; A−/A+ persistence. |

Phone-side `sizeOn` is **redefined** from "user toggled take-control" to "authority currently held"
(driven by the engine's authority state, surfaced via a SIZE-suppress signal or polled), keeping the
existing `termPage.ts:511` SIZE-handler suppression as the revert mechanism.

## 5. Edge cases & failure modes

- **Two clients fight over size** — solved by §1.7: only one authority holder; the desktop wins by
  default; the phone wins only when the desktop is absent/lid-closed. Render-only fit on every other
  client never emits RESIZE.
- **FitAddon runs before `term.open()` / zero-size container** — `fitAddon.fit()` throws on a 0×0
  element; wrap in try/catch and fit *after* open + on the first `visualViewport` event (the element
  has size by then).
- **Keyboard open mid-scroll** — `dvh` + `interactive-widget=resizes-content` shrink the viewport;
  `fit()` on the resize re-fits. iOS falls to the `translateY` path; the bar stays pinned.
- **Lid opens while phone holds authority** — the Rust hook flips `lidClosed→false`; the engine revokes
  authority (audited), resumes forwarding desktop SIZE; the phone's next RESIZE is rejected by
  `gateResize` and its `term.resize` follows the incoming SIZE again.
- **Desktop socket flaps** (brief disconnect <30s) — the grace window prevents authority thrash; only a
  sustained absence flips the viewer-gone state.
- **`lid_closed` unavailable / non-mac OS** — the Rust hook returns `false` (fail toward
  desktop-authoritative); the engine then grants phone authority only on the viewer-gone path.
- **Pull-to-refresh regression** on a browser that ignores `overscroll-behavior` — degrades to current
  behavior; not worse. (Primary target is Android Chrome, which honors it.)
- **Token expiry mid-session** (1h terminal TTL) — unchanged: `repair()` re-pairs (`termPage.ts:180-189`).
- **A pane closes while in the switcher** — reuse the existing 4002 handling (`termPage.ts:483-495`):
  jump to a live pane or back to `/app`.

## 6. Security (RCE-adjacent — be specific about gates)

- **RESIZE stays RCE-adjacent and is *narrowed*, not widened.** Splitting `gateResize` off
  `gateTerminal` adds a *stricter* gate (authority on top of scope+token+armed); it never loosens
  INPUT. RESIZE still goes through the same rate-limiter + `clampDim` (1..1000) so a 0×0/65535 frame
  can't reach the PTY (`server.ts:384-388`), and the Rust core re-checks arming before touching the
  PTY (defense in depth, `server.ts:367-369`).
- **`lidClosed` is `LOCAL_ONLY`.** A paired phone (view/steer/terminal) must never read or *assert* the
  Mac's physical lid/viewer state — only the desktop bearer forwards the real value. Placing it in
  `LOCAL_ONLY_METHODS` (`rpc.ts:206`) makes a remote read a 403 (the same fail-safe that protects
  `auditLog`/`enableRemote`). CI: a view/steer/terminal token calling `lidClosed` → **rejected**.
- **Authority decided server-side.** The phone's `sizeOn` is UI-only (like `armed`,
  `termPage.ts:10,152`); the engine `gateResize` is the real check, and the Rust core is the final
  authority. The phone cannot self-grant size authority by lying about lid state.
- **Audit the RCE channel.** Every authority transition is logged content-free (`§4`), consistent with
  the existing INPUT/arm/disarm/disconnect audit (`server.ts:132-134, 358, 378`). Authority grants are
  the security-relevant event (phone now reshapes the live pane), so they must be in the trail.
- **No new bind / no new transport.** Phase 1 adds no listener and no frame; the Epic-G must-hardens
  (deny-by-default Tailscale ACL, Tailnet Lock, TLS-or-refuse, never `0.0.0.0` —
  `server.ts:209-212`, `mobile-platform-transport` §"Hard gates") are Phase-2 concerns, untouched here.
- **Dropping `user-scalable=no`** (§1.3) is a usability fix, not a security regression — A−/A+ replaces
  it (research anti-pattern: removing zoom *without* offering font control).

## 7. Test plan (machine-verifiable vs `[DEVICE-GATE]`)

**Machine-verifiable (the per-commit gate: engine `bun test` · `tsc` per package · `vite build` ·
`cargo check`/`cargo test` — all green on the branch):**

- `termInput.test.ts` continues to pin `ctrlByte`/`wrapForPaste` (unchanged); if §1.5 changes neither,
  add no new mirror — but the byte-identical mirror in `termPage.ts` must still match (existing rule).
- **`gateResize` unit tests** (engine): rejects when scope≠terminal; rejects when token invalid;
  rejects when pane not armed; rejects when a desktop steer+ socket is active; rejects when lid open;
  **accepts** only when terminal + armed + (lid closed OR viewer-gone >grace). Fake socket-set + fake
  clock + fake `lidClosed`.
- **viewer-presence unit test:** flap <grace → still present; sustained >grace → gone; return → present
  (fake clock).
- **scope-classification test:** the existing "every `METHODS` member lands in exactly one tier" assert
  (V5 7.2.2) now covers `lidClosed` → it must resolve to `local` (`methodScope("lidClosed") === "local"`).
- **`authority` audit event** shape test (content-free; no bytes).
- **Build gates:** `bunx tsc --noEmit` (engine + desktop), `bunx vite build` (desktop), `cargo check`
  in `src-tauri` (the `lid_closed` command compiles + is registered in the `invoke_handler` like the
  `tailscale_serve_*` group, `lib.rs:1022-1026`).
- **Static assert** (cheap): the `TERM_HTML` string contains `overscroll-behavior`, `touch-action`,
  `FitAddon`, `interactive-widget=resizes-content`, and **no** `13 * 0.6` guessed-metric literal
  (regression guard that the guessed path was retired).

**`[DEVICE-GATE]` (founder, Android over Tailscale Serve HTTPS — each clears before Phase 2):**

- 1.1 pull-down does **not** reload; scrollback scrolls with a thumb.
- 1.2 no horizontal cutoff at the default font; lines fit the phone width on load and after rotate.
- 1.3 the key bar is **not** covered when the keyboard opens; the terminal re-fits on open/close.
- 1.4 text is readable at the default; A−/A+ change size and survive a PWA cold-start (localStorage).
- 1.5 sticky-Ctrl produces `^C`/`^D`/etc.; the `/ @ # !` chips insert (no auto-run).
- 1.6 the switcher lists all ~4–5 panes and flags the one waiting.
- 1.7b the phone reshapes the pane **only** when the lid is closed / no desktop viewer; reverts at the
  desk. (CI proves the gate; the device confirms the lid-state plumbing end-to-end.)

## 8. Acceptance criteria

1. On an Android phone over Tailscale Serve HTTPS, the mirror is **fit-to-width** (no horizontal crop)
   by default for **all scopes**, with **native touch-scroll** (no pull-to-refresh) and a soft keyboard
   that never covers the key bar.
2. The guessed-metrics fit path (`termPage.ts:379-394`) is **deleted**; FitAddon is the only fit.
3. Default font is readable (15–16); A−/A+ adjust + persist via localStorage; `user-scalable=no` is gone.
4. The key bar is a compact sticky-Ctrl surface (Esc/Tab/⇧Tab/arrows/Enter/Ctrl/PgUp/PgDn) reusing
   `ctrlByte`, plus `/ @ # !` Claude quick-insert chips; the 12-chip wall is collapsed.
5. A session switcher lists ~4–5 panes and flags the one needing attention (`listPanes` + `agentState`).
6. RESIZE goes through a dedicated `gateResize` that requires terminal-scope + armed **AND** authority
   (lid closed OR no desktop viewer >grace); a `LOCAL_ONLY` `lidClosed()` RPC + a Rust `lid_closed`
   hook back it; every authority transition is audited. CI proves RESIZE is rejected with the lid open
   / a desktop viewer active.
7. The per-commit gate is green on the `feat/v6-p1-mobile-ux` branch (no PR, no merge); commits as
   `prabs0410`.

## 9. Open questions

1. **`lid_closed` on macOS — which API?** `CGDisplayIsActive(CGMainDisplayID())` vs observing
   `NSWorkspace`/IOKit display-sleep notifications vs polling `pmset -g` output. The clamshell case
   (built-in display dead + external monitor) must read as "built-in absent" without false-positiving
   the external. **Default if unanswered:** poll the built-in display's active state in the
   `lid_closed` command; fail toward `false` (desktop-authoritative) on any uncertainty.
2. **Grace window value** — 30s is the spec default; is it configurable via engine config, or fixed?
   **Default:** 30s constant now; lift to config only if QA wants it.
3. **`sizeOn` semantics** — keep the manual `⤢ size` chip at all (as a *request* that only takes effect
   when authority is grantable), or remove it entirely and make authority fully automatic? **Default:**
   remove the manual toggle; authority is automatic (lid/viewer-driven), simpler and matches the
   away-story. Re-confirm with the founder.
4. **Drop the `^C` quick chip** in favor of sticky-Ctrl-then-C, or keep one one-tap interrupt? Research
   says sticky modifiers replace the chips; the interrupt is high-frequency. **Default:** keep a single
   `^C` chip *plus* sticky Ctrl; drop the rest.
5. **PgUp/PgDn vs scrollback gesture** — do hardware PgUp/PgDn add value once touch-scroll works, or is
   a two-finger fling enough? **Default:** ship PgUp/PgDn (cheap; helps TUIs like `less`/`man`).
6. **Tablet/iPad** — the FitAddon fix is a free iPad win; branch by viewport width or ignore?
   **Default (locked):** optimize for phone; iPad is incidental, no width-branch unless warranted.
