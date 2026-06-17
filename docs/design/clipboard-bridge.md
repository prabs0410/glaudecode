# Clipboard bridge — phone ⇄ Mac (V6 Phases 4–5)

> Status: design proposal for `docs/design/`, authored BEFORE the autonomous V6 loop runs (design-doc-first
> is mandated). **New doc** — there is no V5 analogue for clipboard (V5 shipped only the typed-input path and
> the `wrapForPaste` bracketed-paste fix). It builds directly on the V5 input plumbing documented in
> [`mobile-terminal-control.md`](mobile-terminal-control.md) §6 and the Epic-G scope ladder in
> [`epic-g-cockpit.md`](epic-g-cockpit.md) / [`epic-g-remote-threat-model.md`](epic-g-remote-threat-model.md).
> Reuses the decision in [`../research/mobile-platform-transport-clipboard-2026-06-17.md`](../research/mobile-platform-transport-clipboard-2026-06-17.md)
> (the two-tier asymmetric model) — do not re-derive it here.
>
> **HARD PREREQUISITE: Phase-2 HTTPS.** `navigator.clipboard` is `undefined` outside a secure context, and a
> bare tailnet `100.x` IP does **not** get the localhost exception. The cockpit is `http://` on a bare IP
> today (`packages/engine/src/server.ts:200` builds `http://${remoteHost}:${port}/app`). Both tiers below are
> dead code until Tailscale Serve terminates TLS on the `*.ts.net` MagicDNS name (Phase 2.1). **Nothing in
> Phases 4–5 ships before that lands.**

---

## 1. Problem & user value

The founder's job-to-be-done is a voice-first, full-fidelity terminal on the phone, away from a lid-closed
Mac. Two clipboard gaps block it today:

1. **Long / dictated text can't get into the shell reliably.** The only input surface is `#tin`, a soft-keyboard
   `<textarea>` (`termPage.ts:87`). Phone STT and long pastes through a soft keyboard are slow, error-prone, and
   the soft keyboard's own length/IME quirks corrupt multi-line text. **Tier 1 paste** bypasses the keyboard
   entirely — read the phone clipboard, inject it as **one bracketed paste**. This is simultaneously the
   long-paste fix and the voice-first path (dictate into any app → copy → Paste here).
2. **Output can't leave the phone, and the Mac's clipboard can't reach the phone.** Selecting terminal text to
   share it, or pulling a token/path the Mac just copied, has no path. **Tier 1 copy-selection** (phone-local,
   zero new trust boundary) and **Tier 2 `readMacClipboard`** (Mac→phone, a genuine exfil vector, heavily gated)
   close this.

The tiers are **asymmetric by risk** (research §"Clipboard"): Tier 1 is phone-local and reuses an already-audited
RCE channel, so it adds **zero** new trust boundary; Tier 2 lets a remote device read the Mac's `NSPasteboard`
(which may hold passwords/tokens), so it is the most-gated capability in the whole product.

---

## 2. Research (reuse — do not re-derive)

- [`../research/mobile-platform-transport-clipboard-2026-06-17.md`](../research/mobile-platform-transport-clipboard-2026-06-17.md)
  — §"Clipboard — two asymmetric tiers gated by risk" is the locked model this doc implements verbatim. Founder
  decision #2 (LOCKED 2026-06-17): **build Tier 2**, behind the gates. §"Transport" establishes Serve's HTTPS as
  the hinge that unlocks the Clipboard API.
- [`../research/mobile-cockpit-ux-2026-06-17.md`](../research/mobile-cockpit-ux-2026-06-17.md) — anti-pattern note:
  never auto-run pasted/dictated text; the 1-line preview + no-auto-Enter rule comes from the adversarial critique
  there ("a mis-transcribed STT clipboard value should never auto-run in a live shell").
- [`mobile-terminal-control.md`](mobile-terminal-control.md) §6 — the owed Epic-G input-escalation threat model;
  this doc extends it with the Mac→phone exfil case.
- Web Clipboard API constraints (well-known, stated so the loop doesn't trip on them):
  - **Secure context only** — `navigator.clipboard` is `undefined` over plain http (the Phase-2 gate).
  - **Transient user activation** — `readText()`/`writeText()` must run inside a user-gesture handler (a tap).
    Both tiers bind their calls to a button `onclick` to satisfy this.
  - **Permission/UX divergence:** Android Chrome (the primary target) prompts once for read, allows write inside a
    gesture. **iOS Safari** is stricter: `readText()` often shows a per-call paste affordance and `writeText()` is
    gesture-bound; this is acceptable (iOS is "supported when OSS", not gold-plated — founder decision #1). Handle
    the `readText()` rejection/empty path gracefully (§5).

---

## 3. Architecture

### 3.0 The input path Tier 1 rides on (already built, already audited)

Tier 1 sends nothing new on the wire — it reuses the V5 `0x03` INPUT frame end to end:

```
[tap] → navigator.clipboard.readText() → preview → sendText(wrapForPaste(text))
      → sendInput(): 1-byte tag 0x03 + UTF-8 bytes               termPage.ts:153-159
      → ws.send(frame) on /term-ws
      → server.ts gateTerminal(ws): scope==="terminal" + token re-verifies + paneHub.canInput(paneId)   :140-155
      → MAX_INPUT_BYTES = 256 KiB per-frame cap (:100) + inputLimiter 500 frames/s (:101)
      → relayToBridge() → Rust input-bridge → PtyRegistry write (Rust re-checks arming)
      → audit.record({type:"input", deviceId, paneId, bytes})    server.ts:378  (byte COUNT, never bytes)
```

`wrapForPaste` (engine `termInput.ts:8`, mirrored verbatim in `termPage.ts:335`) loops to a fixpoint stripping any
embedded `\x1b[20[01]~` markers, then wraps multi-line text in one bracketed-paste pair — so a clipboard value can't
paste-jack by smuggling its own end-marker (audit H4). One paste = one frame; a generous-for-paste 256 KiB cap.
**Tier 1 changes none of this** — it only adds a new *source* (the phone clipboard) feeding the existing `sendText`.

### 3.1 Tier 1 (Phase 4, phone→Mac) — zero new trust boundary

Pure `termPage.ts`. Add three controls to the key bar (`<div id="keys">`, `termPage.ts:99-112`) and wire them in the
`if (canTypeScope)` block (`termPage.ts:338`), gated by the existing `armed` UI state (the `#inputbar.notarmed`
CSS at `cockpit.ts:43-45` already greys out new key-bar buttons — add the new ids to that selector so they grey too):

- **📋 Paste** (`id="k-paste"`):
  ```js
  document.getElementById("k-paste").onclick = function () {
    if (!navigator.clipboard || !navigator.clipboard.readText) { showPreview("clipboard unavailable (needs HTTPS)"); return; }
    navigator.clipboard.readText().then(function (text) {
      if (!text) return;
      showPreview(previewLine(text));            // 1-line preview, NEVER auto-injects
      pendingPaste = text;                       // armed for the explicit Insert tap
    }).catch(function () { showPreview("paste blocked — tap again to allow"); });
  };
  ```
  The preview is a one-line, length-capped, control-char-stripped rendering (`previewLine`, a tested pure helper —
  see §4). Injection happens on a **second** explicit action (reuse the existing **Insert** button at
  `termPage.ts:88/352`, or a confirm tap on the preview): `sendText(wrapForPaste(pendingPaste))` — **no `\r`**.
- **Paste & run** (`id="k-paste-run"`): a deliberately separate control. `sendText(wrapForPaste(pendingPaste) + "\r")`.
  Distinct button so a mis-dictated value never auto-runs (research critique).
- **⧉ Copy selection** (`id="k-copy"`): `navigator.clipboard.writeText(term.getSelection())` bound directly to the
  tap (gesture rule). `term.getSelection()` is xterm's API; no engine round-trip, no new RPC, phone-local.

**No protocol change, no new RPC, no scope change.** Tier 1 is entirely client-side over the existing terminal WS.

### 3.2 Tier 2 (Phase 5, Mac→phone) — gated, the genuine exfil vector

The engine (Bun sidecar) **cannot** read `NSPasteboard`; only Rust can. So Tier 2 needs a real plumbing chain. The
clean reuse is the **injected-capability pattern** already used for `RemoteControl` (`rpc.ts:300-320`, where the
engine library calls a desktop-supplied callback through `DispatchDeps`):

```
phone tap → cockpit rpc("readMacClipboard")                              (terminal-scope token)
   → POST /rpc → createRpcHandler: tokenLevel + methodScope==="terminal" + levelSatisfies   rpc.ts:738-777
   → dispatch case "readMacClipboard":
        - require deps.clipboardReader (desktop-injected; absent in tests/headless → throw "unavailable")
        - require enrollment: deps.clipboardReader.isEnrolled(deviceId)   ← SEPARATE gate beyond scope (§6)
        - const text = await deps.clipboardReader.read()                  ← bridges to Rust
        - deps.audit.record({type:"mac-clipboard-read", deviceId, deviceName, bytes: text.length})  ← content-free
        - return { text }
```

**Files to touch (Tier 2):**

- `packages/desktop/src-tauri/Cargo.toml` — `cargo add tauri-plugin-clipboard-manager` (alongside the existing
  `tauri-plugin-*` at lines 22/26/27).
- `packages/desktop/src-tauri/src/lib.rs` — `.plugin(tauri_plugin_clipboard_manager::init())` next to the others
  (`:996-998`); a `#[tauri::command] async fn read_mac_clipboard(...) -> Result<String, String>` reading the
  pasteboard via the plugin.
- `packages/desktop/src-tauri/capabilities/default.json` — add `"clipboard-manager:allow-read-text"` to
  `permissions` (the **forgettable** step per AGENTS.md — the capability, not just the plugin).
- **Engine→Rust bridge for the read.** The Rust core already dials the engine (output `/pane-bridge` +
  `/pane-input-bridge`, `lib.rs:329/386`); there is no engine→Rust *request* channel today. Two options for the loop
  to pick from (Open Question Q1): **(a)** a tiny request/response frame on the existing input-bridge socket (engine
  sends a `READ_CLIPBOARD` request frame, Rust replies on the same socket) — minimal new surface, but adds a
  request/response shape to a one-way stream; **(b)** the desktop WebView (already engine-bearer/local scope) holds
  the `clipboardReader` callback in `DispatchDeps` and answers via a short-lived local channel. **Recommended: (a)**,
  keeping the capability inside the trusted Rust↔engine boundary (the WebView shouldn't be on the critical path for
  a remote pull). Whichever is chosen, the engine never reads the OS clipboard itself.
- `packages/engine/src/rpc.ts` — the standard "new engine RPC" checklist (AGENTS.md):
  1. add `"readMacClipboard"` to the `RpcMethod` union (`:44`) and the `METHODS` set (`:113`);
  2. add it to **`TERMINAL_ONLY_METHODS`** (`:205`, empty today) — so `methodScope` returns `"terminal"`;
  3. add a `dispatch` case (`:340`) using a new `deps.clipboardReader`;
  4. extend `DispatchDeps` (`:277`) with `clipboardReader?: ClipboardReader` and define the interface.
- `packages/engine/src/server.ts` — construct the `clipboardReader` (wired to the bridge from above) and pass it in
  the `dispatch(...)` deps spread (`rpc.ts:780-787` shows where deps are assembled; mirror `remoteControl`/`audit`).
- `packages/engine/src/audit.ts` — add `"mac-clipboard-read"` to `AuditEventType` (`:7`) and a `deviceName?: string`
  field (`:15`); the existing `bytes?` field carries the count.
- `packages/engine/src/pairing.ts` — the enrollment allowlist (§6): add `clipboardReader?: boolean` to `PairedDevice`
  (`:49`, default `false`) and methods `enrollClipboard(deviceId)` / `unenrollClipboard(deviceId)` /
  `isClipboardReader(deviceId)`. Pure, unit-tested.
- Desktop enrollment UI: `packages/desktop/src/PairingModal.tsx` (`:36`) — a per-device "clipboard reader" checkbox
  next to each entry in the device list (`reloadDevices`/`devices`, `:54`), default OFF, revocable; client wrappers
  in `packages/desktop/src/engine.ts` next to `listDevices`/`revokeDevice` (`:417-418`). These management RPCs are
  **`LOCAL_ONLY_METHODS`** (desktop bearer only) — a remote device must never enroll itself.
- Cockpit consumer: `packages/engine/src/termPage.ts` — a ⬇ "Pull Mac clipboard" button (terminal scope, armed) that
  calls `rpc("readMacClipboard")`, then shows the result via the same preview + Insert path as Tier 1 (it lands as a
  paste, not auto-run). On 403 (un-enrolled / wrong scope) show a clear "this device isn't a clipboard reader" note.

### 3.3 What to reuse vs. what's new

| Reuse (already built) | New (Phase 4–5) |
|---|---|
| `0x03` INPUT frame, `sendText`, `wrapForPaste` (`termPage.ts:153-159,335`) | 📋/Paste&run/⧉ buttons + preview (Tier 1) |
| `gateTerminal` + 256 KiB cap + 500/s limiter + input audit (`server.ts:97-101,140-155,378`) | `readMacClipboard` RPC in `TERMINAL_ONLY_METHODS` (Tier 2) |
| `methodScope`/`levelSatisfies` ladder, `createRpcHandler` 403 (`rpc.ts:231,700-705,773-777`) | `ClipboardReader` deps + Rust clipboard-manager plugin + capability |
| `RemoteControl` injected-capability pattern (`rpc.ts:300-320`) | per-device enrollment allowlist + `mac-clipboard-read` audit event |
| `PairingModal` device list + `listDevices`/`revokeDevice` (`PairingModal.tsx:54`) | per-device "clipboard reader" checkbox + enroll/unenroll local RPCs |

---

## 4. Data model / protocol

**Tier 1:** no new frames, RPCs, or types. One new pure helper (mirrored, like `wrapForPaste`):

```ts
// packages/engine/src/termInput.ts (tested) + mirrored verbatim in termPage.ts
/** One-line, length-capped, control-char-stripped preview of clipboard text for the confirm UI.
 *  Never used for injection — display only. */
export function previewLine(text: string, max = 80): string {
  const oneLine = text.replace(/[\r\n\t]+/g, " ").replace(/[\x00-\x1f\x7f]/g, "");
  return oneLine.length > max ? oneLine.slice(0, max) + "…" : oneLine;
}
```

**Tier 2 — new RPC:**

```ts
// rpc.ts
type RpcMethod = … | "readMacClipboard";              // union + METHODS set
TERMINAL_ONLY_METHODS = new Set(["readMacClipboard"]); // was empty (:205)

interface ClipboardReader {                            // DispatchDeps.clipboardReader
  read(): Promise<string>;                             // bridges to Rust NSPasteboard read
  isEnrolled(deviceId: string): boolean;               // per-device allowlist check
}
// request:  rpc("readMacClipboard")            (no params; deviceId comes from the verified token)
// response: { text: string }
```

**Tier 2 — new audit event (`audit.ts`):**

```ts
type AuditEventType = … | "mac-clipboard-read";
interface AuditEvent { …; deviceName?: string; /* bytes carries the COUNT, never content */ }
// record: { type:"mac-clipboard-read", deviceId, deviceName, bytes: text.length }
```

**Tier 2 — `PairedDevice` (`pairing.ts:49`):** `clipboardReader?: boolean` (default `false`).

---

## 5. Edge cases & failure modes

- **Not a secure context** (Serve down / opened on bare IP): `navigator.clipboard` is `undefined`. Feature-detect;
  the 📋/⧉ buttons show "clipboard unavailable (needs HTTPS)" rather than throwing. (This is why Phases 4–5 are
  gated on Phase 2.)
- **`readText()` rejected / no gesture / iOS per-call affordance:** `.catch` → "paste blocked — tap again to allow".
  Never silently no-op.
- **Empty clipboard:** `readText()` resolves `""` → do nothing (no empty frame, no preview).
- **Huge clipboard > 256 KiB:** the existing per-frame cap (`server.ts:100`) drops it server-side and audits
  `input-dropped`/`oversized`. Client-side: warn in the preview if `text.length > 256*1024` before sending so the
  user isn't confused by a silent drop.
- **Paste-jack via embedded bracketed-paste markers:** neutralized by `wrapForPaste`'s fixpoint strip (`termInput.ts:8`)
  — applies identically to clipboard-sourced text.
- **Not armed:** Tier 1 buttons are greyed by the `#inputbar.notarmed` CSS (add the new ids to `cockpit.ts:43-45`);
  `sendInput` early-returns if `!armed` (`termPage.ts:154`). Tier 2 `readMacClipboard` requires the pane armed too.
- **Tier 2 race — clipboard changes between tap and read:** `read()` returns whatever is current at read time; the
  audit records the byte count of exactly what was returned. Acceptable (pull-only, explicit).
- **Tier 2 enrollment revoked mid-session:** `isEnrolled` is checked **per pull** (not cached on the token), so
  un-enrolling in `PairingModal` takes effect on the next pull immediately — same liveness as the per-INPUT token
  re-verify (`server.ts:142`).
- **`clipboardReader` dep absent** (headless engine, tests, bridge down): `dispatch` throws `"clipboard reader
  unavailable"` → 400, never a silent empty string.

---

## 6. Security (RCE-/exfil-adjacent — be specific)

**Tier 1 (phone→Mac):** ZERO new trust boundary. It is a new *source* feeding the existing, fully-gated terminal
input channel. Every existing gate applies unchanged: terminal scope (`gateTerminal`, `server.ts:141`), live token
re-verify, armed pane, 256 KiB cap, 500/s limiter, content-free input audit, `wrapForPaste` paste-jack defense. The
**only** new security rules are behavioral and already locked: **no auto-Enter** on Paste (separate "Paste & run"),
and a **1-line preview** before injection. No new attack surface.

**Tier 2 (Mac→phone):** a genuine exfil vector — a remote device reads the Mac's `NSPasteboard`, which can hold
passwords, tokens, recovery codes. **Scope alone is insufficient**, and this is the crux: the scope ladder is
**linear** — `view < steer < terminal` (`pairing.ts:9-21`), and `levelSatisfies` (`rpc.ts:700-705`) grants a
`terminal` token everything at or below `terminal`. Putting `readMacClipboard` in `TERMINAL_ONLY_METHODS` therefore
means **any** terminal-scope device can call it by default. That is too broad for clipboard exfil. So the gate is
**defense-in-depth, ALL required**:

1. **Desktop opt-in OFF by default** — a global toggle (off until the founder turns it on); if off, the RPC is
   refused regardless of device.
2. **Terminal scope** — `TERMINAL_ONLY_METHODS` → `methodScope` returns `"terminal"` → 403 for any view/steer token
   at `rpc.ts:773-776`.
3. **Armed pane** — same arming state the input path requires.
4. **Per-device "clipboard reader" enrollment allowlist** (the gate scope can't provide): `PairedDevice.clipboardReader`,
   default OFF, set via a `PairingModal` checkbox per device, revocable, managed by `LOCAL_ONLY` RPCs (desktop bearer
   only — a remote device can never enroll itself). `dispatch` checks `isEnrolled(deviceId)` and refuses an
   un-enrolled terminal token.
5. **Per-pull consent** — each pull is an explicit tap (no ambient/background sync); **pull-only, never push.**
6. **Content-free audit** — `mac-clipboard-read` records `{deviceId, deviceName, byteCount}`, **never the content**
   (mirrors the input audit's byte-count-only rule, `audit.ts:20`). `auditLog` readback stays `LOCAL_ONLY`
   (`rpc.ts:217`) — a remote device can't read who pulled what.

This must be documented in the Epic-G threat model as a new exfil surface (per the master human-gate checklist).
Forbidden: ambient/polling clipboard sync, returning content in any audit/log, enrolling a device from a remote token,
exposing the read over a non-terminal scope.

---

## 7. Test plan

**Machine-verifiable (CI — the per-commit gate: engine `bun test` · `tsc` per package · `vite build` · `cargo check`/`cargo test`):**

- `previewLine` unit tests: multi-line collapse, control-char strip, length cap + ellipsis, empty input. (engine)
- `wrapForPaste` already-tested fixpoint strip — add a clipboard-sourced fixture with an embedded `\x1b[201~` to
  assert no early termination. (engine)
- **Scope classification (extends `test/rpc.test.ts:287` / `test/secureDefaults.test.ts:36`):**
  `methodScope("readMacClipboard") === "terminal"`; it is in exactly one tier set (the existing 7.2.2 invariant).
- **Authorization matrix (the locked CI assert):** `readMacClipboard` is **rejected (403)** for a **view** token and
  a **steer** token (`levelSatisfies` false), and **rejected** for an **un-enrolled terminal** token
  (`isEnrolled === false` → dispatch refuses), and **rejected** when the desktop opt-in is OFF; it **succeeds** only
  for an **enrolled terminal** token with opt-in ON + armed.
- `pairing.ts` enrollment unit tests: default `false`, enroll/unenroll, `isClipboardReader`, and that `revokeDevice`
  clears enrollment with the device.
- Audit unit test: a `mac-clipboard-read` event records `bytes`/`deviceName` and **no content field exists** to leak.
- Builds: engine `tsc`; desktop `vite build` (Tier-1 termPage string compiles); `cargo check`/`cargo test` after the
  clipboard-manager plugin + capability are added (`touch src/lib.rs && cargo build` to defeat the cached-build lie,
  per AGENTS.md).

**`[DEVICE-GATE]` (founder, Android over Serve — never counts as a loop failure):**

- **T1-paste:** copy a long multi-line block on the phone → 📋 → preview shows one line → Insert lands the whole block
  as one paste, no auto-run, no per-line submit.
- **T1-voice:** dictate into another app → copy → 📋 → Insert → the dictated text is in the pane.
- **T1-copy:** select terminal text → ⧉ → paste elsewhere on the phone shows the selection.
- **T2-pull:** with opt-in ON + this device enrolled + pane armed, ⬇ pulls the Mac clipboard into the preview.
- **T2-deny:** an un-enrolled / view / steer device's pull is refused with a clear message (mirrors the CI assert).
- **T2-audit:** the desktop `mac-clipboard-read` audit shows the pull with a byte count and device name, **no content.**
- iOS spot-check (when OSS): `readText()` per-call affordance behaves; `writeText()` works in-gesture.

---

## 8. Acceptance criteria

- [ ] **Gated on Phase 2:** all clipboard controls feature-detect `navigator.clipboard` and degrade to a clear
      "needs HTTPS" message over plain http.
- [ ] **Tier 1:** 📋 Paste reads the clipboard, shows a 1-line preview, and injects via `sendText(wrapForPaste(...))`
      with **no auto-Enter**; "Paste & run" is a separate control that appends `\r`; ⧉ Copy-selection writes
      `term.getSelection()` bound to the tap. No new RPC, no protocol change, no scope change.
- [ ] **Tier 2:** `readMacClipboard` exists in `TERMINAL_ONLY_METHODS`; reads the Mac clipboard only via the Rust
      clipboard-manager plugin (engine never touches the OS clipboard); pull-only.
- [ ] **Tier 2 gates (all enforced):** desktop opt-in OFF by default + terminal scope + armed pane + per-device
      enrollment allowlist (default OFF, revocable, local-only management) + per-pull consent + content-free
      `mac-clipboard-read` audit.
- [ ] **CI:** un-enrolled / view / steer token is rejected for `readMacClipboard`; the scope-tier invariant
      (7.2.2) still passes; `previewLine`/`wrapForPaste`/enrollment/audit unit tests pass.
- [ ] Tier-2 exfil surface documented in the Epic-G threat model.
- [ ] All commits attributed to `prabs0410`, on branch `feat/v6-p4-clipboard-tier1` / `feat/v6-p5-clipboard-tier2`,
      tests + builds green per phase; **no PR / no merge**.

---

## 9. Open questions

1. **Engine→Rust read channel for Tier 2** (§3.2): a request/response frame on the existing input-bridge socket
   (recommended — keeps the capability inside the Rust↔engine trust boundary) vs. a WebView-held `clipboardReader`
   callback. The loop should pick (a) unless it surfaces a concrete blocker, then fall back to (b) and flag it.
2. **Desktop opt-in granularity:** one global "allow Mac→phone clipboard" toggle (recommended for V6) vs. relying
   solely on per-device enrollment. The plan specifies both; confirm the global toggle is the master switch and
   per-device enrollment is the allowlist beneath it.
3. **Tier-1 preview placement on a 360px viewport with the keyboard up:** reuse the `#smart-q` area, a transient
   toast above `#inputbar`, or inline in the textarea placeholder? (Layout-budget question deferred to the Phase-1
   mobile-UX work; pick the lightest that's visible with the keyboard open.)
4. **`writeText` failure UX on iOS** for ⧉ Copy-selection (gesture edge cases) — acceptable to show "copy not
   supported on this browser" and move on (iOS is supported-not-gold-plated)?
