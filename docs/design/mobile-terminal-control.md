# Driving the whole GlaudeCode terminal from your phone — responsible recommendation

> Status: design proposal for `docs/design/`. Produced by a 15-agent research workflow (mirroring
> tech, transport, mobile UX, security, architecture, prior art) with adversarial verification of every
> load-bearing claim against source. Refuted/overstated claims are corrected and flagged inline. This
> document also satisfies the owed **Epic G remote threat-model** for the input-escalation case (see §6).

## 1. TL;DR verdict

**Achievable — for terminals that run *inside* GlaudeCode, and only after new plumbing is built.** The
Rust core owns every PTY it spawned (`PtyRegistry`, pane-keyed). With a new **engine↔PTY bridge** and a
remote-input path, GlaudeCode can mirror those panes to your phone and route keystrokes back, over *your
own* network with no vendor cloud relay. That is the differentiation versus Anthropic's Remote Control,
Happy, and Omnara (which relay through a vendor cloud and largely only "view").

**This does not exist today — it is net-new work, not a config flip.** Verified: the engine (the only
process the phone reaches) has **zero** PTY access. Its WebSocket `message()` handler is a literal no-op
(`server.ts:103-105`), the cockpit only handles `approvals` frames (`cockpit.ts:148`), and there is
**no** PTY method anywhere in the engine RPC union (`rpc.ts`). The PTYs are Tauri commands callable
**only** from the local WebView via `invoke()`. So a phone hitting the engine cannot reach a PTY: the
engine has no API to write to one, and no channel to ask Rust to. Both the mirror (Rust→engine) and the
input path (phone→engine→PTY) must be built.

**Not achievable for terminals in a separate app** (iTerm, Terminal.app, a hand-started tmux). By
design, GlaudeCode cannot control PTYs it did not spawn. *Caveat (an earlier draft said "infeasible,"
which is too strong):* macOS terminals are scriptable via AppleScript and scrapable via the
Accessibility API, both TCC-gated and brittle — we are **deliberately not** going there (fragile,
permission-heavy, out of our ownership model). The honest scope is: **panes started inside GlaudeCode.**
Want a Claude Code session drivable from your phone? Start it as a GlaudeCode pane.

**Transport: Tailscale is the right transport — but "Tailscale alone" (the raw `100.x.y.z` IP over
`http`) is not sufficient even for the PWA experience this design wants.** A private IP over `http` is
**not a secure context** (only `localhost`/`127.0.0.1` get the exception), so an installable PWA +
service worker won't register and `wss://` is unavailable. The fix is **Tailscale Serve**, which
provisions a real Let's Encrypt cert on your MagicDNS `*.ts.net` name while staying **private to the
tailnet (zero public exposure)**. Do **not** default to Funnel/Cloudflare (public internet +
arbitrary-command shell = wrong trade). The view-only ceiling is **not** "just a cockpit feature gap" —
it is partly that **and** a real architectural gap (no engine→PTY path). Tailscale being adequate as
transport does not, by itself, unlock terminal control.

**Security is the gate, not a footnote.** Mirroring a PTY upgrades remote access from "approve/deny" to
**arbitrary command execution as you**. That is a different product in a different risk class. It ships
**only** behind a new dedicated `terminal` scope, per-pane opt-in, a hardened pairing path, and desktop
audit/echo + kill-switch. Until those land, remote *input* stays off by default.

## 2. What's feasible vs not

| Capability | In-GlaudeCode pane | Separate terminal app (iTerm/Terminal.app/manual tmux) |
|---|---|---|
| View live output on phone | Yes — tee the existing PTY reader (net-new bridge) | No — GlaudeCode never sees those bytes |
| Type / `cd` / run commands | Yes — route to `pty_write` (net-new input path) | No — not our PTY |
| Steer a Claude Code session | Yes *if it runs as a GlaudeCode pane* (`claude --session-id …` is just a pane) | No |
| Answer a multi-option AskUserQuestion | Yes — phone renders the real Claude TUI **and** we add tappable buttons (§5; not "free") | No |

**Verified against source.** The PTY lives in Rust (`portable_pty`'s `native_pty_system().openpty(...)`,
`lib.rs:160-205`). Its reader thread emits raw bytes **only** to the WebView via
`app.emit("pty-output:{paneId}", buf[..n].to_vec())` (`lib.rs:218-237`). Input returns through
`pty_write` (`lib.rs:243-251`, takes `pane_id` + `data: String`, writes raw bytes and flushes — **no
parsing, allowlist, or approval**). `cmd`/`args` run `claude --session-id <uuid>` directly, so the pane
hosts the genuine interactive Claude TUI.

**What does *not* exist today (all verified):**
- No PTY/`sendInput`/`sendKeys`/`writePane` method in the engine RPC union (`rpc.ts:41-105`); the
  desktop `engine.ts` client has no PTY RPC.
- The cockpit WS is push-only: `open()` sends approvals, a 2s interval re-broadcasts approvals, and
  `message()` is a no-op (`server.ts:96-105`).
- Rust runs **no** inbound server — it reads only the first stdout line of the engine sidecar as the
  `{port, token}` handshake (`lib.rs:304-325`) and discards the rest. There is currently **no channel
  from the engine back into Rust's PTY layer at all**.

So "drive the terminal from a phone" requires, minimally: a new engine↔PTY bridge, a remote-input
transport (a non-noop WS message path or a new scoped RPC), a phone-side terminal emulator, and a new
scope + UI. None of it exists.

## 3. Recommended mirroring architecture + data path

**Pick option (a): the Rust core opens a localhost WebSocket back to the engine and tees pane traffic
over it.**

*Why not the alternatives:* moving PTYs into the Bun engine (option b) forks the spawn path and
**duplicates load-bearing Rust logic** — verified as real and Rust-bound: `portable_pty`
(`lib.rs:160-205`), the ~90-line zsh ZDOTDIR wrapper that writes rc files at runtime for
autosuggestions/syntax-highlighting/dir-scoped history/smart-Tab/OSC emission with careful save/restore
(`lib.rs:52-141`), the `GLAUDECODE_MANAGED` env that scopes the approval hook so a closed app doesn't
strand a bare `claude` (`lib.rs:203` set-side; `approval-hook.ts:38` read-side), and OSC 133/7 emission
(`lib.rs:118-123`). A move means porting ~100 lines of Rust + zsh templating into TypeScript and
swapping the PTY API. Shared memory (option c) adds an IPC mechanism the codebase doesn't use.

*Two honesty corrections (verification caught these):*
- **The choice is NOT forced by technical impossibility.** As of **Bun v1.3.5, Bun has native PTY
  support** (`Bun.spawn({ terminal })`, Zig-implemented, no node-gyp), so moving PTYs to the engine is
  *feasible*. The reason to prefer (a) is **duplication cost**, not feasibility.
- **Option (a) is not a free "tee."** The Rust crate currently has **no** WebSocket/HTTP-client
  dependency (`Cargo.toml`: only `tauri`, `serde`, `portable-pty`). Option (a) requires adding a WS
  crate (e.g. `tokio-tungstenite`), token auth, reconnect/backpressure, **and** an input return path
  (cockpit → `pty_write`) that does not exist today. Still materially cheaper than porting the
  shell-integration stack — the comparative conclusion stands — but it has real plumbing cost.

**Concrete data path:**

```
PTY child ─► Rust reader thread (lib.rs:218-237) ─┬─► app.emit("pty-output:{paneId}") ─► desktop xterm  (UNCHANGED)
                                                  └─► pane-bridge WS ─► engine PaneHub ─► cockpit WS frame ─► phone xterm
phone keystroke ─► cockpit WS ─► engine ─► pane-bridge WS ─► Rust pty_write_internal ─► PTY child
```

The desktop xterm path is untouched; remote is **purely additive** (tee one line in the reader's `Ok(n)`
arm). The engine is a **dumb byte relay** (it never parses PTY bytes — xterm.js in the phone browser
does) **and** the **policy enforcement point** (scope + per-pane allowlist). The byte-handling brain
stays in Rust.

**Wire protocol (engine↔phone):** a dedicated binary WebSocket per pane with a ttyd-style 1-byte opcode
(`0x00` data, `0x01` resize, `0x02/0x03` pause/resume) so one channel carries output, input, and resize
unambiguously. **Do not use xterm's off-the-shelf `AttachAddon`** — it can't resize and truncates binary
(`charCodeAt(i) & 255`); write the ~40-line custom attach instead. Keep the existing JSON approvals path
exactly as-is; the terminal mirror is a **separate** binary socket.

**Three correctness items the implementation must handle:**
- **Backpressure.** xterm.js silently drops data above its internal buffer; a `cat bigfile` on a slow
  phone link overruns it. Implement pause/resume watermarks (HIGH ~100 KB, LOW ~10 KB) and, when paused,
  stop *reading* the PTY so the producer blocks. Critically, the **local terminal must never stall
  because a phone is attached** — the tee enqueue is non-blocking, drop-oldest.
- **Reconnect + scrollback.** Phones drop connections constantly. Keep a bounded per-pane ring buffer
  (~256 KB) in the engine `PaneHub`; on (re)attach, replay it then send live frames, so the phone sees
  the current screen, not a blank pane.
- **Resize / terminal-size negotiation (one PTY, two viewers).** Not optional polish: a transport that
  fails to carry resize/size negotiation makes the Claude TUI mis-render and breaks arrow/number/vim
  navigation (cf. Claude Code #13504). Founder decision in §8; recommended default below.

**Key files.** Rust PTY core `packages/desktop/src-tauri/src/lib.rs` (reader 218-237, `pty_write`
242-251, `pty_resize` 253-268). Engine server `packages/engine/src/server.ts` (no-op `message()`
103-105, `/ws` auth 129-135, remote bind 71-89). Cockpit `packages/engine/src/cockpit.ts` (WS handling
142-150). New code: `packages/desktop/src-tauri/src/pane_bridge.rs` (adds `tokio-tungstenite` — a
dependency, not a Tauri plugin, so no `capabilities/default.json` change) and
`packages/engine/src/paneHub.ts` (the relay + ring buffer, unit-tested per the "logic lives in
`@glaudecode/engine`" rule). Refactor `pty_write`/`pty_resize` into `*_internal` free fns so both the
Tauri command and the bridge can call them.

## 4. Transport recommendation

**Tailscale is the correct transport; use Tailscale Serve, not the bare IP.**

- **Tailscale Serve (recommended default).** Auto-provisions a Let's Encrypt cert on the node's MagicDNS
  `*.ts.net` name, terminates TLS locally, and stays **private to the tailnet (no public exposure)**.
  This unlocks the **installable PWA + service worker** (which need a real HTTPS origin — a `100.x`
  private IP over `http` gets no localhost secure-context exception) and clean `wss://`. *Precision:*
  today's cockpit ships a manifest but registers **no** service worker and already speaks `ws://` over
  `http` (`cockpit.ts:143`), so nothing is *broken* over plain `ws` today — Serve **unlocks** the
  installable-PWA/`wss` experience going forward. One-time prerequisite: the tailnet admin must enable
  **MagicDNS + HTTPS certificates** in the admin console.
- **Plain tailnet bind (zero-config fallback).** The existing second listener on the Tailscale IP
  (`server.ts:69`, `http://${remoteHost}:${port}/app`) keeps working for a non-installed web page and
  plain `ws://`. WireGuard already encrypts it end-to-end. Keep it as the fallback when Serve isn't set up.
- **Tailscale Funnel — not the default.** Exposes the service to the **whole public internet**, drops
  the tailnet guarantee, has no built-in DDoS/WAF. For an arbitrary-command terminal, wrong default.
- **Cloudflare Tunnel / ngrok — escape hatch only.** Public, **and a third party terminates TLS and sees
  plaintext keystrokes/output** at their edge. Offer `cloudflared` only as an explicit, loudly-labeled
  "no-Tailscale" path gated behind the security review.

**Recommendation:** default to **Tailscale Serve**; keep the plain tailnet bind as zero-config fallback;
offer `cloudflared` as a labeled opt-in only. Skip self-hosted relay and WebRTC (both reinvent what
WireGuard already does).

**Tailnet ACL caveat (must harden).** Tailscale's default ACL is **allow-all** — *every* node on your
tailnet can reach the port, including `/pair` and `/app`. On a **shared** tailnet this is a real
exposure. Add a tailnet policy restricting the engine port to only your phone's node, and document it as
a MUST for shared tailnets.

## 5. Mobile input UX — incl. solving the rich-prompt gap

**Honest correction (verification refuted an earlier claim):** a PTY mirror does **not** "inherently"
close the multi-option AskUserQuestion gap "independent of any added UI." Phones have **no**
arrow/Enter/Esc/Ctrl/Tab keys; every working mobile terminal client (Blink, Termius, Moshi) **adds an
on-screen accessory key bar**. So a mirror lets the phone *render* the real Claude TUI, but answering its
menu still requires added on-screen controls — you trade an approval-button UI for an arrow/Enter-button
UI; you do **not** get input "for free." Mobile terminal emulation is also fragile (xterm.js weak mobile
touch support; iOS doesn't reliably fire arrow keydown; Android predictive keyboards corrupt the
stream). The mirror gives **generality**; structured buttons give **a usable common case**. Ship both.

Real xterm.js loads in a new cockpit terminal route (`/app/term`), capability-gated so the existing
dependency-free approvals view stays untouched. Three input layers:

**Mode A — "Message" (the 80% case, the default).** A native `<textarea>` + Send that writes the text
then `\r` to the pane, wrapping multi-line in bracketed paste (`\x1b[200~…\x1b[201~`) exactly like the
desktop already does (`TerminalPane.tsx:211`). This sidesteps almost every mobile-terminal pain — you
get autocorrect, dictation, and paste **as features**. Offer Send vs Insert (no trailing Enter).

**Mode B — "Keys" (the raw-TUI accessory bar — what the mirror actually requires).** A persistent bar
pinned above the keyboard via the VisualViewport API, carrying the keys the soft keyboard lacks: **Esc,
Tab, Shift+Tab (`\x1b[Z` — cycles Claude Code modes), arrows, Enter, and a sticky/chainable Ctrl** (tap
Ctrl then C → `\x03`). Hold-and-slide for arrows. This bar is **mandatory**, not optional — without it
the mirror cannot answer a TUI prompt.

**Mode C — GlaudeCode's semantic layer (the differentiation).** Because the cockpit *knows* it's Claude
Code: render AskUserQuestion options as **tappable buttons** that send the right arrow-count + Enter;
mode pills ("plan / accept-edits / normal") from `agentState`; common-input chips ("yes" / "continue" /
Esc-to-interrupt); one-tap **snippets** from the existing `PromptStore`.

**How the rich-prompt gap actually closes — two complementary fixes:** (1) the PTY mirror means the
phone renders the *actual* Claude TUI, so with the Mode-B key bar you can arrow + Enter through **any**
prompt (general fallback); (2) Mode C parses the structured prompt and renders buttons (better
common-case UX). Ship both; neither alone is sufficient.

**Multi-session steering.** The cockpit's session list becomes the home screen; each row attaches to that
pane's live terminal, with a state dot (idle/thinking/running-tool) and a badge when a session has a
pending approval or AskUserQuestion. One pane full-screen at a time; swipe between attached sessions.
**Attach/detach is explicit** so you're not streaming every pane's bytes at once — only the foreground
pane streams; the rest are summarized by the `agentState` the cockpit already polls.

## 6. Security: threat model + MUST-DO list + the new `terminal` scope

**The core delta in one sentence.** View+approve has an *intrinsic* safety gate — the approval
classifier is fail-closed and a human still says yes. A raw terminal **removes that gate**: `pty_write`
is unmediated keystroke injection = arbitrary command execution as you (`lib.rs:243-251`, no
parsing/allowlist/approval). The bar for a `terminal` capability must be **categorically** higher than
for `steer`, not incrementally higher.

**Two precision notes (from verification):**
- *"Bypasses the approval gate" is true only for shell panes.* The gate is a Claude Code `PreToolUse`
  hook that fires **only** on the agent's own tool calls inside `GLAUDECODE_MANAGED` panes. Raw bytes
  into a **shell** pane never trip it — full bypass. Raw bytes typed as a **prompt** into a Claude pane
  still get the agent's downstream tool calls gated. `pty_write` is *always* unmediated, but downstream
  execution is *not* universally un-gated.
- *"`steer` does not satisfy `terminal`" is prescriptive, not current enforcement.* Today **no** remote
  path reaches `pty_write` at all. The engine's "default to `steer`" fail-safe would **not** protect
  terminal input either, because `pty_write` isn't an RPC method governed by `methodScope`. So the new
  scope must be backed by an **actual, explicitly-checked** engine→PTY bridge.

**What's already good (verified).** Localhost-only by default (`server.ts:43`); `enableRemote`/
`disableRemote` are `LOCAL_ONLY_METHODS` so a paired phone can't widen its own exposure; pairing codes
are 8 hex chars, single-use, 2-min TTL, in-memory-only; deny-by-default scope policy; CORS pins the
WebView origin; approvals fail-closed.

**MUST-DO before shipping remote input (1–7 are blockers):**

1. **New `terminal` scope, distinct from `view`/`steer`.** Today `TokenScope = "view" | "steer"`
   (`pairing.ts:8`). Add it; every raw-input/`pty_*` frame requires it; **`steer` must NOT satisfy
   `terminal`**. Folding terminal input into `steer` would silently widen *every existing* steer token.
2. **Per-pane explicit opt-in to remote input, default OFF.** The user arms a specific pane "allow
   remote input" **on the desktop**. A terminal token can only write to armed panes.
3. **Rate-limit + lockout on `/pair`.** `/pair` runs before any bearer check and has **no** throttling.
   A successful guess now yields a **shell**, not just approve/deny. Match code-server (~2/min,
   exponential backoff, lockout).
4. **Move the token off the WebSocket query string.** `/ws?token=` can be the **local bearer token**
   itself — a URL/log/Referer leak leaks the engine's primary credential. Authenticate via
   `Sec-WebSocket-Protocol` or a first-message auth frame; never let the local bearer be the WS credential.
5. **Origin/Host allowlist on the WS upgrade — for DNS-rebinding defense, not CSWSH.** *(Correction: the
   missing Origin check is NOT cross-site WebSocket hijacking — `/ws` uses a secret `?token=`, no
   cookies, so a blind cross-origin connect is rejected 401.)* The genuinely unauthenticated,
   rebinding-reachable surfaces are **`/pair` and `/health`**. Add Origin + Host-header allowlisting as
   defense-in-depth.
6. **TLS-or-refuse for non-loopback binds; refuse `0.0.0.0` outright.** `enable(host)` binds any
   interface with no warning. If not loopback and TLS isn't demonstrable, don't bind (or bind read-only).
7. **Audit log + live desktop echo of every remote keystroke** (device, time, pane, byte count) with a
   "phone is driving" indicator. Best detection control + deterrent.

**Also keep the `/pane-bridge` (Rust↔engine) socket desktop-bearer-only** — it must reject paired tokens,
or a phone could impersonate the Rust core. Add a test that a paired token gets 401 on `/pane-bridge`.

**Ship soon after:** short TTL + idle-revoke for terminal tokens (minutes, not 24 h); a one-action
kill-switch (`disableRemote()` + revoke-all + disarm-all-panes); per-message rate limit + size cap on
input; and remote-driven Claude tool calls must still pass through the fail-closed approval queue.

**This is exactly the owed Epic G remote threat-model.** Going from "approve/deny" to "arbitrary
keystroke injection into a live shell" is the precise escalation the review must cover — complete it
**before** this ships.

## 7. Effort / phasing

- **Phase 0 — Threat-model review + founder decisions (BLOCKING).** Complete the Epic G review for the
  input escalation. Lock the `terminal` scope, resize-authority, per-pane-opt-in policies.
- **Phase 1 — Pane bridge (no remote yet).** `tokio-tungstenite` client in Rust; tee the reader;
  refactor `pty_write`/`pty_resize` into `*_internal` free fns; `/pane-bridge` (desktop-bearer-only) +
  `PaneHub` + ring buffer. Verifiable entirely on localhost.
- **Phase 2 — Cockpit terminal (view-only first).** `/app/term` route with real xterm.js,
  attach/replay/live-output, `listPanes` view RPC, session switcher. Read-only — proves rendering +
  scrollback + resize before any write path.
- **Phase 3 — Security hardening (blockers 1–7).**
- **Phase 4 — Remote input UX.** Wire keystroke/resize frames (terminal-scope-checked per frame), the
  three input modes, semantic AskUserQuestion buttons, the mandatory on-screen key bar.
- **Phase 5 — Transport polish.** Tailscale Serve (incl. the MagicDNS/HTTPS admin prerequisite); tailnet
  ACL guidance; `cloudflared` as labeled opt-in.

Phases 1–2 are safe to build immediately (localhost / view-only). **Phase 4 (remote write) must not merge
until Phase 0 and Phase 3 are done.**

## 8. Decisions for the founder

1. **Resize authority** when desktop + phone view the same pane: desktop-authoritative-while-focused with
   an explicit "take control of size" toggle for the lid-closed case **(recommended)** vs
   phone-can-take-control vs last-resize-wins.
2. **Per-pane opt-in vs blanket:** remote input armed per-pane, default off **(strongly recommended)**.
3. **Terminal token TTL:** keep 24 h vs shorten to minutes with idle-revoke **(recommended: shorten)**.
4. **Transport default:** adopt Tailscale Serve **(recommended)**; ship the `cloudflared` public escape
   hatch only as a labeled opt-in behind the security review **(recommended)**.
5. **Scope model:** add a distinct `terminal` tier **(recommended)** vs reuse `steer` **(not
   recommended — collapses the safety boundary)**.
6. **PWA or plain web page:** is the installable PWA worth requiring Serve, or is a plain tailnet web
   page enough for v1? (Plain page works over `ws://` today; PWA needs Serve.)
7. **PTY ownership model:** confirm we stay with option (a) Rust-owned PTY + bridge **(recommended)**.
   Bun *can* now host PTYs natively (v1.3.5) if we ever revisit — the decision is duplication cost.

## 9. Honest risks / unknowns

- **Mobile terminal emulation is genuinely fragile.** "Arrows + Enter just work" is optimistic even with
  the key bar — expect iteration. The Mode-A "Message" textarea is the robust default.
- **TUI fidelity over a remote pipe can break despite correct keycodes** (resize/size negotiation, key
  encodings — cf. #13504). Budget for it.
- **Shared tailnets are a real exposure.** Default Tailscale ACL is allow-all; `/pair` and `/health` are
  unauthenticated and rebinding-reachable. The tailnet ACL + Host allowlist are MUSTs there.
- **This is the highest-risk capability GlaudeCode will have shipped.** A pairing-code compromise now
  yields a shell, not just approve/deny. The blast radius justifies the full blocker list + threat-model.
- **External-terminal control remains out of scope** and should stay there.

## What this does NOT do (stated plainly)

- It does not control terminals in iTerm/Terminal.app/standalone tmux — GlaudeCode doesn't own those
  PTYs (and we decline the brittle AppleScript/Accessibility workaround).
- It does not introduce a vendor cloud relay — the control plane stays on infrastructure you own.
- It does not weaken the existing view+approve model — remote input is additive, scoped (`terminal`),
  per-pane-armed, and off by default.
