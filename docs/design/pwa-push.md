# PWA hardening + self-hosted Web Push (V6 Phase 3)

> **V5 analogue:** [`epic-g-cockpit.md`](epic-g-cockpit.md) shipped the served `/app` cockpit — a
> self-contained, dependency-free page with a `display:standalone` manifest, pairing + scoped-token
> auth, and a live `/ws` approvals stream. This doc is the **V6 Phase 3** upgrade-on-top: it makes the
> cockpit a *real* installable PWA (PNG icons + service worker + offline shell) and adds **self-hosted
> VAPID Web Push** so Claude can tap you on the shoulder while the phone screen is off.
>
> **Hard gate:** Phase 3 is **gated on Phase 2 (Tailscale Serve HTTPS)**. A service worker won't
> register and `PushManager.subscribe` won't run without a **secure context** — and a bare tailnet
> `100.x` IP does *not* get the localhost secure-context exception. The cockpit is `http://` on a bare
> IP today — verified `server.ts:203` (`url: ...http://${remoteHost}...`) and the bind comment at
> `server.ts:200`. Do not start Phase 3 until Serve serves the cockpit over `https://*.ts.net`.
>
> **Plan:** [`resilient-singing-jellyfish.md`](../../.claude/plans/resilient-singing-jellyfish.md) Phase 3
> (tasks 3.1–3.4). **Research reused (do not re-derive):**
> [`mobile-platform-transport-clipboard-2026-06-17.md`](../research/mobile-platform-transport-clipboard-2026-06-17.md)
> (the "Serve's HTTPS is the hinge" finding; the push notify-policy as a *prerequisite*) and
> [`mobile-cockpit-ux-2026-06-17.md`](../research/mobile-cockpit-ux-2026-06-17.md) (alert-then-act loop;
> the `notify.ts`/EventBus taxonomy reuse).

---

## 1. Problem & user value

The founder's job-to-be-done is **alert-then-act**: a push wakes the phone → they open the installed
PWA → the mirror reconnects/replays → they answer. With the Mac lid closed on a charger (built-in
display dead) and 4–5 sessions running, the only thing standing between "I never miss an approval" and
"I have to keep the laptop open" is a notification that arrives when the screen is off.

Today the cockpit cannot deliver that:

1. **Not a real installable PWA.** The manifest's only icon is an inline **SVG data URI** (`cockpit.ts:9`,
   referenced at `cockpit.ts:26`). Android's install/maskable pipeline wants real raster PNGs; an SVG
   data-URI icon installs poorly and renders no proper maskable adaptive icon.
2. **No service worker.** Grep-confirmed: `cockpit.ts` registers no SW, and `server.ts` serves no
   `/app/sw.js` (it serves `/app`, `/app/manifest.json`, `/app/term`, `/app/xterm.js`, `/app/xterm.css`,
   `/app/addon-fit.js` only — `server.ts:406-442`). Without a SW there is **no offline shell** and, more
   importantly, **no `push` event handler** — Web Push *requires* an active service worker.
3. **No push at all.** The only live channel is the `/ws` approvals socket (`cockpit.ts:236-250`), which
   dies the moment the phone backgrounds the tab. `notify.ts` already *coalesces* a notification taxonomy
   (`finished`/`approval`/`error`/`budget`/`question`) but nothing carries it to a backgrounded phone.

**Value when done:** the cockpit installs to the Android home screen like an app, survives a flaky link
(offline shell), and — the headline — **buzzes the phone when Claude needs the founder** (an approval, an
AskUserQuestion, a session finishing/idling, or an error), *without* a held socket and *without Firebase*
(self-hosted VAPID keeps it OSS-clean and dependency-light). Push is the mechanism that makes "never open
the laptop while away" real.

---

## 2. Research (cite, don't re-derive)

- **"Serve's HTTPS is the hinge"** — `mobile-platform-transport-clipboard-2026-06-17.md` §Transport:
  *"`navigator.clipboard` is `undefined` over plain http, and a service worker / Web Push won't register
  without a secure-context origin — and a bare tailnet IP does not get the localhost exception. Serve's
  cert is the single move that unlocks installable-PWA + self-hosted Web Push + clipboard, all at once."*
  → **Phase 3 is strictly downstream of Phase 2.**
- **Self-hosted VAPID, no Firebase** — same doc §Sequencing(3): *"self-hosted VAPID Web Push via the Node
  `web-push` lib (no Firebase, OSS-clean)."* The browser's push service (FCM endpoint for Chrome/Android,
  Mozilla autopush for Firefox, Apple for Safari) is reached **directly** with a VAPID-signed request — no
  Google project, no app server key.
- **Push policy is a prerequisite, not a follow-up** — same doc §Hard-gates: *"With 4-5 sessions,
  per-message push trains ignore-behavior and defeats the away-story. Required before VAPID:
  approval-needed + idle/done only, per-session mute … wired to the existing `notify.ts` / EventBus
  taxonomy."* And the LOCKED founder decision (§Founder-decisions 4): *"buzz on approval-needed +
  question-asked (AskUserQuestion) + session done/idle + error/crash. Never per-message. Per-session mute
  available."*
- **Alert-then-act loop** — `mobile-cockpit-ux-2026-06-17.md` + the same doc §Founder-decisions 3: push
  *prevents missed approvals without a held socket*; the ~1 s reconnect-on-open is acceptable. This is why
  a pure PWA is sufficient forever and we are **not** building a native foreground service.
- **iOS caveat (Android-first)** — §Founder-decisions 1: *"iOS is supported when the project is
  open-sourced … the iOS PWA-push caveats are noted but not a priority."* See §5/§6 for the specifics.

---

## 3. Architecture (files to touch, control/data flow, what to reuse)

All four sub-tasks live in the **engine** (the served cockpit + the push sender are both engine
responsibilities); the only desktop touch is exposing a couple of RPC wrappers if a UI affordance is
wanted (the founder-swappable VAPID key is config, not UI). The Rust core is **not** involved — push is a
pure web + Node concern.

### 3.1 Real PNG maskable icons (replaces the SVG data URI)

- **Generate** two real PNGs (192×192 and 512×512) for the GlaudeCode mark on a `#0d1117` field, plus a
  **maskable** variant with safe-zone padding (Android adaptive icons crop to a circle/squircle; the SVG
  has no safe zone). Vendor them into the engine as bytes the same way xterm.js is vendored
  (`readVendor(...)`, `server.ts:37`) — e.g. `packages/engine/vendor/icon-192.png`,
  `icon-512.png`, `icon-512-maskable.png`, loaded into module constants.
- **Serve** them at `/app/icon-192.png` etc., adding GET routes beside the manifest route
  (`server.ts:409-410`), `content-type: image/png`.
- **Rewrite `MANIFEST_JSON`** (`cockpit.ts:17-27`) to drop `ICON_SVG` and list the real PNGs with
  explicit `purpose`: a `"any"` entry and a separate `"maskable"` entry (do **not** reuse one file for
  both purposes — `"any maskable"` on a non-safe-zoned image is the anti-pattern the icon swap exists to
  fix). Keep `display:standalone`, `id`/`start_url`/`scope` = `/app`, the dark `background_color`/
  `theme_color`.
- Reuse: the static-serve pattern (`server.ts:428-441`) and the `application/manifest+json`
  content-type already wired at `server.ts:410`.

### 3.2 Service worker (offline shell + push handler)

- **New constant `SW_JS`** in `cockpit.ts` (a string, like `COCKPIT_HTML`), **served at `/app/sw.js`** with
  `content-type: text/javascript` — add the GET route beside the others (`server.ts:406-442`). **Scope
  matters:** a SW served from `/app/sw.js` controls the `/app/` scope, which is exactly the cockpit's
  `scope` — correct. (Serving it from a deeper path would narrow its scope and break control of `/app`.)
- **Register** it from the cockpit bootstrap (`cockpit.ts`, in `start()`): `if ('serviceWorker' in
  navigator && location.protocol === 'https:') navigator.serviceWorker.register('/app/sw.js')`. Gate on
  `https:` so a dev/loopback `http://` load is a no-op (no console error, no half-registered SW).
- **SW responsibilities (keep it minimal — the trusted core is the live mirror, not an offline app):**
  1. **Offline app shell:** on `install`, cache the shell (`/app`, `/app/xterm.js`, `/app/xterm.css`,
     `/app/addon-fit.js`, the icons). On `fetch`, **network-first** for navigations with a cached-shell
     fallback so a flaky link shows the UI chrome instead of the browser's dino. **Never cache `/rpc`,
     `/ws`, `/term-ws`, `/pair`, `/push-subscribe`** — those are live/authed and must always hit network
     (a cached approval list would be dangerously stale).
  2. **`push` handler:** `self.addEventListener('push', ...)` → parse the JSON payload → `showNotification`
     with the title/body/tag/data from §3.4. **`tag` = the notification kind (or `kind:sessionId`)** so a
     re-fire *replaces* rather than stacks (coalescing parity with `notify.ts`).
  3. **`notificationclick` handler:** focus an existing `/app` client or open one; if the payload carries a
     `paneId`/`sessionId`, deep-link to `/app/term?pane=…` (the existing mirror route, `server.ts:425`) so
     the tap lands on the waiting pane.
- **A SW update path:** bump a `SW_VERSION` constant in the cache name so a redeploy evicts the old shell
  (`skipWaiting` + `clients.claim` so a refresh activates the new SW promptly).

### 3.3 Self-hosted VAPID Web Push (Node `web-push`, no Firebase)

**Dependency:** `bun add web-push` into `packages/engine` (pure-Node, no native bits, OSS-clean — the
Agent-SDK-breaks-on-`--compile` constraint doesn't apply; the engine ships as a Bun *script*).

**Keypair lifecycle (loop auto-generates; founder can swap):**
- New module `packages/engine/src/push.ts` (pure logic + thin I/O seam, unit-testable):
  - `generateVapidKeys()` (wraps `webpush.generateVAPIDKeys()`) → `{ publicKey, privateKey }`.
  - **Persist** the keypair in **engine config** — a small JSON file under the engine's config dir (the
    same place other engine-local state lives; **not** `~/.claude`, per Principle XI). On boot:
    load-or-generate-and-write. Document that the founder can drop in a **persistent** keypair (so a
    config wipe doesn't invalidate every subscription) by replacing the file — the loop's auto-gen is the
    zero-config default, not the final word.
  - **Never** put the private key in any served response or audit line. The cockpit only ever receives the
    **public** key (the `applicationServerKey` for `PushManager.subscribe`), exposed via a new
    **view-scoped** RPC `pushPublicKey()` (read-only → `VIEW_METHODS`, `rpc.ts:186`) or inlined into the
    served page. Public-key exposure is safe by design.

**Subscription store:**
- An in-memory `Map<deviceId, PushSubscription[]>` (a device may have >1 browser/endpoint). Subscriptions
  are **keyed by the paired `deviceId`** (from `pairing.verify` → `VerifyResult.deviceId`, `pairing.ts:58-61`)
  so **revoking a device drops its push** in lock-step (hook `pairing.revoke` → evict the device's subs).
  In-memory matches the rest of the engine's "no secret at rest" posture; a persisted store is an optional
  later hardening (subs survive an engine restart) and is **not** in autonomous scope.

**`POST /push-subscribe` — the one new network endpoint (security-critical):**
- Add a route in `server.ts` `fetch` beside `/pair` (`server.ts:447`). Unlike `/pair` (which is
  pre-auth by design), **`/push-subscribe` requires a paired token and `steer`+ scope.** Flow:
  1. Read the `Authorization: Bearer <token>` header → `pairing.verify(token)` → `{ ok, scope, deviceId }`.
  2. **Scope gate:** require `scopeSatisfies(scope, "steer")` (reuse `pairing.ts:20`). A **view-only token
     → `403`** (it cannot act on an approval, so it has no business subscribing to push about one). A
     missing/invalid token → `401`.
  3. **Rate-limit per device:** a dedicated `RateLimiter` keyed by `deviceId` (reuse the `RateLimiter`
     pattern already used for `/pair`, `server.ts:93-96`) — e.g. a few subscribes/min, generous for a
     real install, hostile to a loop. Over limit → `429`.
  4. **Validate** the body shape (`{ endpoint, keys:{p256dh, auth} }`); reject malformed → `400`.
  5. **Store** under `deviceId`; **audit** `{deviceId, action:"push-subscribe"}` (see §4 — a **new**
     `AuditEventType`, no endpoint/keys/content recorded).
  6. Return `{ ok: true }`.
- An `unsubscribe` companion (`POST /push-unsubscribe`, same gate) lets per-session mute / sign-out drop a
  sub cleanly; optional but cheap.

**Send path (wire into §3.4):** a `sendPush(deviceIds, payload)` in `push.ts` iterates the device's subs
and calls `webpush.sendNotification(sub, JSON.stringify(payload), { vapidDetails })`. **Prune dead subs:**
a `404`/`410` from the push service means the subscription expired → evict it from the store (standard
Web Push hygiene). Network/transient errors are logged, not fatal.

**Control flow end-to-end:**
```
EventBus lifecycle event  ──┐
ApprovalQueue pending     ──┤  notify-policy filter (§3.4, reuses notify.ts kinds)
AskUserQuestion pending   ──┤        │  coalesce (notify.ts:coalesceNotifications)
session idle / error      ──┘        ▼
                              sendPush(steer+ devices' subs, {kind, title, body, tag, sessionId})
                                     │  webpush.sendNotification (VAPID-signed, direct to push service)
                                     ▼
                       push service (FCM / autopush / Apple) ──► installed PWA's service worker
                                     │  'push' event → showNotification (tag = kind)
                                     ▼
                       founder taps ──► notificationclick → focus/open /app(/term?pane=…)
```

### 3.4 Notify policy (wire to `notify.ts` + EventBus)

- **Trigger set (LOCKED, exhaustive):** `approval` + `question` + (`done`/`idle` i.e. `finished`) +
  `error`. **NEVER per-message.** These map 1:1 onto the existing `NotificationKind` union in `notify.ts:8`
  (`finished | approval | error | budget | question`) — note `question` was added in **P0a** (confirmed
  present, `notify.ts:6-8`). `budget` is **not** in the locked push trigger set (it's a desk-time concern,
  not an away-buzz); leave it out of the push filter for now.
- **Sources (reuse, don't re-derive):**
  - `approval` ← the `ApprovalQueue` already feeding the `/ws` snapshot (`server.ts:160` `approvalsForScope`,
    pushed in `cockpit.ts:248`). When a *new* pending approval appears, fire one push.
  - `question` ← an AskUserQuestion pending (the same signal `promptState.isWaiting` surfaces, consumed at
    `cockpit.ts:218`).
  - `finished`/`error` ← the **EventBus** (`eventBus.ts`): `session_shutdown`/idle transitions and error
    states the bus already fans out (`eventBus.ts:7-15`). Subscribe a push-emitter handler with `bus.on("*",
    …)`; handler failures are isolated by the bus (`eventBus.ts:64-71`) so a push hiccup never blocks other
    subscribers.
- **Coalesce** through `coalesceNotifications` (`notify.ts:16`) before sending, so "3 sessions finished"
  is one push, not three. The SW's `tag = kind` gives a second layer of OS-side coalescing (replace, not
  stack).
- **Per-session mute (LOCKED):** a cockpit toggle per session → persisted in **`localStorage`** (survives
  PWA cold-start, per the UX research) **and** echoed to the engine so the *send* path can drop a muted
  session's pushes server-side (client-only mute still wakes the radio). A muted session fires **no** push
  of any kind until unmuted.
- **Severity tiers** (different vibration/priority per kind) are **optional/deferred** — not in autonomous
  scope (plan §3.4, "Severity tiers optional/deferred").

---

## 4. Data model / protocol (new RPCs / endpoints / types)

| Surface | Name | Scope / auth | Shape | Notes |
|---|---|---|---|---|
| HTTP | `POST /push-subscribe` | **steer+** paired token (view → 403, none → 401) | req `{ endpoint, keys:{p256dh, auth} }` → res `{ ok:true }` | rate-limited per `deviceId`; audited. **New.** |
| HTTP | `POST /push-unsubscribe` | steer+ | `{ endpoint }` → `{ ok:true }` | optional companion for mute/sign-out. **New.** |
| RPC | `pushPublicKey` | **view** (`VIEW_METHODS`, `rpc.ts:186`) | `() → { publicKey: string }` | the VAPID `applicationServerKey`; safe to expose. **New.** |
| RPC | `muteSession` / `unmuteSession` | steer | `{ sessionId } → { ok }` | server-side mute echo for §3.4. **New (optional).** |
| Config | VAPID keypair | local-only file | `{ publicKey, privateKey }` JSON in engine config dir | auto-gen on first boot; founder-swappable. **New.** |
| Audit | `AuditEventType` add `"push-subscribe"` (and `"push-unsubscribe"`) | — | `{ type, at, deviceId }` — **no endpoint, no keys, no content** | extends `audit.ts:7-13`; content-free, matching the existing RCE-audit posture (`audit.ts:1-4`). **New.** |
| Push payload | (SW `push` event JSON) | — | `{ kind: NotificationKind, title, body, tag, sessionId?, paneId? }` | `kind` reuses `notify.ts:8`; `tag`=`kind` (or `kind:sessionId`) for replace-coalescing. **New.** |

**RPC wiring checklist** (per AGENTS.md "New engine RPC"): for each new RPC (`pushPublicKey`,
`muteSession`, `unmuteSession`) — add to the `RpcMethod` union + the `METHODS` set + a `dispatch` case in
`rpc.ts`, classify its scope (`pushPublicKey` → `VIEW_METHODS`; the mute pair → defaults to `steer`, which
is correct), and (if the desktop needs them) add a client wrapper in `desktop/src/engine.ts` + export from
`index.ts`. The **7.2 scope-tier test** (every `METHODS` member lands in exactly one tier) must stay green.

**Pure-logic seam for tests:** `push.ts` holds the testable units — `generateVapidKeys`, the
load-or-generate persistence, the subscription store (add/evict-by-device/prune-on-410), and a
`shouldPush(kind, muted)` policy predicate. The `webpush.sendNotification` call is the only impure edge,
injected so tests don't hit the network.

---

## 5. Edge cases & failure modes

- **No HTTPS yet (Phase 2 not done):** SW register and `subscribe` are no-ops behind the `location.protocol
  === 'https:'` guard. The cockpit still fully works over loopback `http://` for desk-side dev — push is
  simply unavailable. No crash, no half-state.
- **Permission denied / dismissed:** if the user denies notification permission, never re-prompt in a loop;
  show a one-line "push off — enable in browser settings" affordance. The cockpit still works (the `/ws`
  live socket covers the foregrounded case).
- **Subscription expired / rotated** (push service returns `404`/`410`): evict the sub on the next send;
  the cockpit re-subscribes on next open (idempotent `subscribe`). A stale endpoint never blocks other
  devices' pushes.
- **Engine restart with in-memory subs:** all subscriptions are lost → the cockpit must **re-subscribe on
  every open** (cheap, idempotent, rate-limited). Document this; a persisted store is the optional fix.
- **VAPID key change** (founder swaps the keypair, or auto-gen runs again after a config wipe): every prior
  subscription is invalidated by the push service (signed by the old key) → they fail and get pruned;
  clients re-subscribe with the new public key on next open. Acceptable; the swap is a deliberate, rare act.
- **Coalescing vs. urgency:** a flood of `finished` events coalesces to one push (good); but an `approval`
  and a `question` are **distinct kinds** → distinct tags → both surface (correct — don't let a chatty
  `finished` mask a blocking approval).
- **Token expiry mid-subscription:** the `terminal` scope token is capped to ~1h (`pairing.ts:92`), `steer`
  longer. A push *delivery* doesn't need a live token (the push service holds the endpoint); but
  *subscribing* does. If a token expires, the next `/push-subscribe` 401s and the cockpit re-pairs — the
  existing 4003/re-pair flow (`cockpit.ts:244`) covers it.
- **iOS PWA-push caveats (Android-first, documented not gold-plated):**
  - iOS Safari supports Web Push **only for a PWA the user has added to the Home Screen** (not in the
    browser tab) and only iOS 16.4+. The `apple-mobile-web-app-capable` meta (`cockpit.ts:36`) is already
    present, which helps the add-to-home-screen path.
  - iOS requires the `subscribe` call to happen **in response to a user gesture** — so wire the
    "Enable notifications" subscribe behind an explicit button tap, not an auto-call on load (this is good
    practice on Android too).
  - iOS push wakeups are throttled/best-effort and the home-screen-PWA requirement is easy to miss. We
    **note** these and don't optimize for them until OSS (per the locked Android-first decision); the
    Android path (FCM endpoint, no Firebase project needed for VAPID) is the supported target.

---

## 6. Security (RCE-adjacent — be specific about gates)

This cockpit can answer approvals and (terminal scope) drive a live shell, so every new surface is treated
as part of the RCE threat model (`epic-g-remote-threat-model.md`).

- **HTTPS-or-nothing.** Push is *defined* to be unavailable without Serve's TLS (§5). This is a feature,
  not a limitation: it means push can't be stood up over the insecure bare-IP bind that exists today
  (`server.ts:200/203`). Phase-2's TLS-or-refuse-for-non-loopback posture (plan §2.1) still holds.
- **`/push-subscribe` is steer-gated, not pre-auth.** Unlike `/pair` (pre-auth by necessity,
  `server.ts:447`), subscribing requires a **valid paired token of `steer`+ scope**. A **view-only token
  gets `403`** — enforced by `scopeSatisfies(scope, "steer")` (`pairing.ts:20`), the *same* ladder the RPC
  scope check uses (`rpc.ts:775`). Rationale: a view device can't act on an approval, so it must not be
  able to register to be *told* about one (information-leak + a path to nag a read-only observer).
  **CI assert:** a view token → 403; no token → 401; a steer/terminal token → 200.
- **Per-device rate limiting.** A dedicated `RateLimiter` keyed by `deviceId` (the `/pair` limiter pattern,
  `server.ts:93`) caps subscribe churn so a compromised-but-paired device can't flood the store or be used
  to amplify pushes. Over limit → `429`.
- **Content-free audit.** The new `push-subscribe` audit event records **only** `{deviceId, action}` and a
  timestamp — **never** the endpoint URL, the `p256dh`/`auth` keys, or any payload — matching the existing
  RCE-audit "byte count, never bytes" rule (`audit.ts:1-4,20`). The audit log itself stays **local-only**
  readback (`auditLog` ∈ `LOCAL_ONLY_METHODS`, `rpc.ts:217`) — a remote device can't read who subscribed.
- **VAPID private key never leaves the engine.** Stored in the local config dir, never in a served
  response, never logged, never audited. Only the **public** key is exposed (it's the
  `applicationServerKey` — public by spec). The keypair file lives in engine config, **not `~/.claude`**
  (Principle XI: the adapter is the only `~/.claude` toucher).
- **Payload minimization.** Push payloads carry a kind + a short title/body + an optional `sessionId`/
  `paneId` for deep-linking — **never** the tool `input`, the Bash command, file paths, or the approval
  `reason` (the same redaction `approvalsForScope` enforces for view devices, `server.ts:160-169`). A
  notification body should say *"Claude needs approval in `<session title>`"*, not *"run `rm -rf …`"*.
  Push payloads transit the third-party push service (FCM/autopush) — treat them as **not confidential**.
- **Revocation lock-step.** Subs are keyed by `deviceId`; `pairing.revoke` (`rpc.ts:629`) must evict the
  device's subs so a revoked phone stops getting pushed immediately — parity with the existing per-INPUT
  re-verify + 2 s socket sweep that cuts a revoked terminal device (`server.ts:140-155`, `:117-121`).
- **Out of autonomous scope (release prerequisite):** app-layer E2E crypto (SPAKE2 + Noise) — plan §"E2E
  crypto". Push payloads are deliberately low-sensitivity precisely *because* the transport (Serve) is the
  current security boundary and E2E hasn't shipped.

---

## 7. Test plan (machine-verifiable vs `[DEVICE-GATE]`)

**Per-commit gate (all green before the next phase):** engine `bun test` · `bunx tsc --noEmit` per package
· `bunx vite build` (desktop) · `cargo check`/`cargo test` in `src-tauri`.

**Machine-verifiable (unit/integration, in `@glaudecode/engine`):**
- `generateVapidKeys()` returns a well-formed `{publicKey, privateKey}` pair.
- **Key persistence:** boot with no config → a keypair is generated **and written**; second boot **reuses**
  the persisted pair (no regeneration). A founder-swapped file is loaded verbatim.
- **`/push-subscribe` scope gate (the headline assert):** a **view** token → **403**; **no token → 401**;
  a **steer** (and `terminal`) token → **200** and the sub is stored under the right `deviceId`.
- **Rate limit:** N+1 subscribes from one `deviceId` within the window → **429**.
- **Audit:** a successful subscribe emits exactly one `{type:"push-subscribe", deviceId}` event with **no
  endpoint/keys/content** field present.
- **Revocation:** `pairing.revoke(deviceId)` evicts that device's subs (a subsequent send targets zero subs
  for it).
- **Dead-sub pruning:** a `sendNotification` rejecting with 404/410 (injected) evicts the sub.
- **Notify policy / `shouldPush`:** `approval`/`question`/`finished`/`error` → push; `budget` and a muted
  session → **no** push; coalescing maps a batch of same-kind to one payload (reuse/extend the existing
  `coalesceNotifications` tests).
- **RPC scope-tier test (7.2):** `pushPublicKey` ∈ `VIEW_METHODS`; the mute RPCs land in `steer`; every
  `METHODS` member is in exactly one tier (the test must stay green after the additions).
- **Manifest:** `MANIFEST_JSON` parses; lists real PNG `src`s with a distinct `"maskable"` entry and no
  `data:` URI; the icon routes return `image/png`. The `/app/sw.js` route returns `text/javascript`.

**`[DEVICE-GATE]` (founder, Android over Serve — not loop-verifiable):**
- The cockpit **installs** to the Android home screen with a correct **maskable** adaptive icon (no SVG
  fallback square).
- The **service worker registers** over `https://*.ts.net` and the **offline shell** renders the UI chrome
  when the link is cut.
- **A real push lands on the installed Android PWA with the screen off** — triggered by a real
  approval/question/finished/error — and **tapping it opens the cockpit on the waiting pane**. *(This is
  the canonical Phase-3 device gate from the plan, §3.3.)*
- **Per-session mute** suppresses that session's pushes; unmute restores them.

*(iOS: noted, not gated this phase — Android-first.)*

---

## 8. Acceptance criteria

1. The manifest serves **real PNG** icons (192 + 512 + a safe-zoned **maskable** 512); the SVG data URI is
   gone (`cockpit.ts:9,26`).
2. `/app/sw.js` is served (`text/javascript`); the cockpit **registers** it over HTTPS only; it provides an
   **offline app shell** and **never caches** live/authed endpoints (`/rpc`, `/ws`, `/term-ws`, `/pair`,
   `/push-subscribe`).
3. The engine **auto-generates and persists** a VAPID keypair on first boot, reuses it thereafter, and the
   private key never appears in any served response, log, or audit line; the founder can swap the file.
4. **`POST /push-subscribe`** requires a **steer+** paired token (view → **403**, none → **401**), is
   **rate-limited per `deviceId`** (over → 429), and emits a **content-free** `{deviceId, action}` audit
   event. Subs are keyed by `deviceId` and **evicted on `revoke`** and on **404/410**.
4. `pushPublicKey` is a **view-scoped** RPC; the cockpit fetches it as the `applicationServerKey` and
   subscribes behind an explicit user gesture.
5. Push fires **only** on `approval` + `question` + `finished`(done/idle) + `error`, **never per-message**,
   honors **per-session mute**, and **coalesces** via `notify.ts` (tag = kind). Payloads carry **no** tool
   input / command / file path / approval reason.
6. The full per-commit gate is green; all listed unit tests pass; commits attributed to **prabs0410**, on
   branch `feat/v6-p3-pwa-push`, **no PR / no merge**.

*(Numbering intentionally has two "4"s collapsed in the source list above — the load-bearing items are the
six distinct bullets; renumber on review if desired.)*

---

## 9. Open questions

1. **Persisted subscription store?** In-memory means re-subscribe-on-open after every engine restart
   (cheap, but a missed push in the gap between restart and next open). Persisting subs (and the keypair —
   already persisted) closes that gap. Defer to a later hardening, or pull in now? *(Recommendation:
   defer; re-subscribe-on-open is acceptable for the alert-then-act loop.)*
2. **Where is "engine config dir"?** Confirm the canonical path the engine already uses for local state so
   the VAPID file sits beside it (and is **not** under `~/.claude`). Resolve before 3.3.
3. **`finished`/idle precision.** EventBus has `session_shutdown` but "idle/done" (Claude stopped, awaiting
   you) may need an explicit idle signal. Does the bus already emit a usable idle transition, or do we
   derive it from `agentState` (as `cockpit.ts:217` does for the dot)? Confirm the source before wiring 3.4.
4. **Mute echo to engine, or client-only?** Client-only mute still wakes the radio (the push already
   arrived). Server-side mute (the optional `muteSession` RPC) is more correct but adds RPC surface.
   Ship client-only first, add the echo if radio-wake noise is felt?
5. **Icon source asset.** The loop must *generate* the PNGs — from what source (render the SVG mark at
   192/512 with maskable padding, or a founder-supplied asset)? Default: render the existing `G`-on-`#0d1117`
   mark with a safe-zone-padded maskable variant; founder can replace.
