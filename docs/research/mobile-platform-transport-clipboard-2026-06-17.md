# Mobile: Platform · Transport · Clipboard — Research & Decision (2026-06-17)

> Decision-ready output of a 5-agent research workflow (platform + transport + clipboard, synthesis,
> adversarial security/feasibility critique). Every load-bearing code claim was verified against the
> repo. Companion to [`mobile-cockpit-ux-2026-06-17.md`](mobile-cockpit-ux-2026-06-17.md) and the
> vision memory. Founder is **Android-first**; Mac's built-in display is **dead** (external monitor at
> the desk), so "away" = **lid closed, on charger, reachable over the network**.

## Platform — PWA now; Capacitor-Android only *if* a specific pain appears (likely never)

Keep the served cockpit (`termPage.ts`: vendored xterm.js + the binary OUTPUT/SIZE/INPUT/RESIZE WS
protocol + `wrapForPaste`) as **the single rendered artifact, forever.** It's the *trusted core* (shows
every Claude approval/prompt/TUI variation natively) and it's plain web that runs in any WebView.

- **Reject Flutter / React-Native / Tauri-2-Mobile / fully-native.** Every native-render path throws
  away `termPage.ts` and forces a *second* terminal implementation that must independently reproduce
  every prompt variation — the one thing we least want subtly wrong. "Reuse our Tauri stack on mobile"
  is an **illusion**: the React desktop UI can't run on mobile (it pulls the Node-only Agent SDK); the
  cockpit is already a separate served page, i.e. just a PWA.
- **The reframe that matters (from the critique):** the real question is **not** "PWA vs native" — it's
  *"do you need the mirror LIVE while your screen is off, or just to be ALERTED and then act?"*
  - **Alert-then-act** (push wakes you → open phone → mirror reconnects + replays ring → you answer):
    **the PWA does this today.** Push prevents missed approvals *without* a held socket.
  - **Ambient warm sockets** (4-5 mirrors stay live screen-off): *only* a native Android foreground
    service can do this — and it's materially hard (Android 14+ FGS type rules, ~6h/24h dataSync cap,
    mandatory persistent notification). This is the **only** thing Capacitor adds.
  - So: **PWA is almost certainly sufficient indefinitely.** Capacitor-Android (wraps the *same* page,
    sideloaded APK, no Play account) is a documented optional power-build, triggered only by real
    "I need the mirror live screen-off" pain — not speculation.

## Transport — one Tailscale **Serve** config = direct-LAN-first *and* remote-fallback

- Tailscale (already shipped) automatically gives a **direct ~1 ms LAN path** when co-located (your
  phone hotspot, or both on home wifi) **and** NAT-traversed remote path on cellular — **same stable
  MagicDNS name, no transport switching** between "at the desk" and "away." This already *is* the
  layered "direct-LAN-first, mesh-fallback" stack, for free.
- **Use Tailscale *Serve*** (not bare `100.x` IP, not Funnel). Serve provisions a Let's Encrypt cert on
  the `*.ts.net` name → **HTTPS/wss**. This is the **hinge**: `navigator.clipboard` is `undefined` over
  plain http, and a service worker / Web Push won't register without a secure-context origin — and a
  bare tailnet IP does **not** get the localhost exception. **Serve's cert is the single move that
  unlocks installable-PWA + self-hosted Web Push + clipboard, all at once.** (Cockpit is `http://` on a
  bare IP today — verified `server.ts:200`.)
- **Forbid public-URL / TLS-terminating tunnels** (Cloudflare, ngrok, Tailscale Funnel) for the shell:
  public ingress + a third party decrypting an **RCE channel**.
- **LAN-direct via the mesh is still WireGuard-encrypted** → safe even on a hostile coffee-shop wifi.
  The danger is only a *bare* mDNS/`_glaudecode._tcp` direct bind that bypasses mesh crypto — defer that
  until app-layer E2E ships; it's a marginal nicety for a one-phone/one-Mac setup.
- **OSS alternatives to document:** NetBird self-host (BSD-3, TURN forwards ciphertext) for full
  ownership; plain WireGuard + a $5 VPS as the DIY path.

## Clipboard — two asymmetric tiers gated by risk

- **Tier 1 — ship first (pure `termPage.ts`, ZERO new trust boundary): phone → Mac.** A **📋 Paste**
  button reads the phone clipboard and feeds it straight into the existing
  `sendText(wrapForPaste(text))` → one `0x03` INPUT frame. This is **also the long-paste fix** (bypasses
  the soft-keyboard `<textarea>` limit entirely) and the voice-first input path. The pipe is more than
  adequate (`MAX_INPUT_BYTES=256 KiB`, one paste = one frame; `wrapForPaste` emits one bracketed pair
  with the fixpoint marker-scrub). Add **⧉ Copy selection** (`navigator.clipboard.writeText(getSelection())`
  bound to the tap to satisfy the gesture rule) for terminal-output → phone.
  - **Safety (critique):** do **not** auto-append `\r`. "Paste & run" must be a deliberate *second*
    control. Show a **1-line preview** before injecting — a mis-transcribed STT clipboard value should
    never auto-run in a live shell.
- **Tier 2 — gated, defer: Mac → phone.** Genuine exfil (Mac clipboard may hold passwords/tokens).
  Needs the Tauri clipboard-manager plugin (only Rust can read `NSPasteboard`) + a **new `readMacClipboard`
  RPC placed in `TERMINAL_ONLY_METHODS`** (confirmed empty today, `rpc.ts:205`) + desktop opt-in **OFF by
  default** + terminal scope + armed pane + **per-pull consent** + a content-free `mac-clipboard-read`
  audit event (records `{deviceId, byteCount}`, never content). **Pull-only on explicit tap; never
  ambient sync.** Build only if the founder actually wants it.

## Sequencing (respects the locked terminal-first plan)

1. **NOW — device-test the mirror fix that already shipped** (`fix/v5-audit`: `7a8f795`/`feb095d`/`18290d6`).
   Do **not** write new mirror code yet; build the deferred Rust-owned per-pane screen ring + flood
   coalescing **only if blank persists** in real use.
2. **Tailscale Serve / TLS** — pull it early; it gates PWA-install + push + clipboard.
3. **PWA hardening** — real PNG maskable icons (today an SVG data URI), a service worker, self-hosted
   **VAPID Web Push** via the Node `web-push` lib (no Firebase, OSS-clean).
4. **Clipboard Tier 1** — phone→Mac paste + long-paste + copy-selection.
5. **Gated/later** — clipboard Tier 2 (`readMacClipboard`); Capacitor-Android (only on real screen-off pain).

## Hard gates / preconditions (do NOT skip)

- **Keep-awake reachability is THE precondition.** A *sleeping* Mac drops the Tailscale node and **no
  transport recovers it.** Verify the lid-closed/clamshell setup keeps the Mac **network-reachable**, not
  just awake (ties to the lid-close research: `pmset disablesleep` / Amphetamine, on charger). Highest-
  leverage check before any push work.
- **Push notify-policy is a prerequisite, not a follow-up.** With 4-5 sessions, per-message push trains
  ignore-behavior and defeats the away-story. Required before VAPID: approval-needed + idle/done only,
  per-session mute, severity tiers — wired to the **existing `notify.ts` / EventBus** taxonomy.
- **Epic-G must-hardens before relying on remote bind:** the shipped Tailscale ACL is **allow-all** → add
  a deny-by-default grant scoping the engine port to the phone's identity; **enable Tailnet Lock**;
  TLS-or-refuse for non-loopback; **never bind `0.0.0.0`.**
- **App-layer E2E (SPAKE2 + Noise/AEAD, Phase 3, NOT built) is what makes transport stop being the
  security gate** and is the public-release + any-bare-LAN-bind prerequisite. Until it ships: Tier-A mesh
  transports only, trusted-only direct-LAN, no public tunnels. Mesh coordinator/relay still leaks
  metadata (who-talks-to-whom, timing) even with opaque payload — state it.
- **Resize authority is already built** (desktop-authoritative + take-control, `termPage.ts:510-516`).
  Add a **lid-closed auto-grant**: when no desktop viewer is present (lid shut, dead built-in display),
  the phone should own cols/rows; revert to desktop-authoritative back at the desk.

## Founder decisions (LOCKED 2026-06-17)

1. **iOS:** Android-first. iOS is supported when the project is open-sourced (don't preclude it, don't gold-plate it) — so the iOS PWA-push caveats are noted but not a priority.
2. **Mac→phone clipboard (Tier 2):** **BUILD IT** — worth the exfil surface, behind the gates (Tauri clipboard plugin + `readMacClipboard` in `TERMINAL_ONLY_METHODS` + desktop opt-in OFF by default + armed pane + per-pull consent + content-free `mac-clipboard-read` audit; pull-only, never ambient sync).
3. **Live-vs-alert loop:** **ALERT-THEN-ACT** confirmed (buzz → open phone → mirror reconnects/replays → answer). Decisive consequence: **stay a pure PWA forever — do NOT build the Capacitor/native app.** The ~1s reconnect on open is acceptable; ambient warm sockets are not needed.
4. **Push policy:** buzz on **approval-needed + question-asked (AskUserQuestion) + session done/idle + error/crash**. **Never per-message** (would train ignore-behavior across 4-5 sessions). **Per-session mute** available. Wire to the existing `notify.ts` / EventBus taxonomy; HTTPS-via-Serve + a service worker + self-hosted VAPID Web Push (no Firebase).
