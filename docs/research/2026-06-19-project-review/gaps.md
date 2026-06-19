# GlaudeCode — Gap Analysis

*Produced by a multi-agent review (2026-06-19) across three lenses: product gaps, architecture debt, and test coverage, cross-checked against the competitive landscape.*

This is a candid assessment, not a roadmap. Severities are called as they are. The headline: the **terminal mirror is a solid trusted core, but the away-mode cockpit — the entire reason for the V6 pivot — is not yet real.** Several "shipped" surfaces (conversation view, tap-to-answer, arming) are render veneers or half-built features that fail silently in exactly the founder's primary scenario (lid-closed, `claude`-in-a-shell, voice-first). That directly contradicts the "silent failure is the enemy" mandate.

---

## 1. The away-mode cockpit doesn't actually work away (HIGH)

These five gaps share one root cause: the product promises "close the lid, walk away, drive Claude from your phone," but each link in that chain is missing or unsound. Together they mean the central deployment scenario silently fails.

### 1.1 No push pipeline — the phone can never pull the founder back (HIGH, effort L)
- **Where:** `packages/engine/src/pushPolicy.ts`, `packages/engine/src/server.ts`, `packages/engine/src/rpc.ts`
- **Why it matters:** A lid-closed, away cockpit is pull-only today. Every high-signal moment (approval, `AskUserQuestion`, finished, error) — the `PUSH_KINDS` are *already enumerated* — silently does nothing. The phone is a screen the founder must keep open and watch, which defeats the "replace the company remote" reason the product exists. Every competitor that wins the away-mode use case (Omnara, Cursor cloud agents) leads with "we buzz you when the agent needs you"; the DIY crowd hand-rolls `ntfy` hooks precisely because this is non-negotiable.
- **Direction:** Build P3 even behind the HTTPS gate, as the goal already instructs. Add a service worker served like the manifest, a `POST /push-subscribe` endpoint (steer+ scope, rate-limited, audited), a VAPID keypair persisted in engine config, and a delivery call-site that runs `shouldPush()` then web-push on notify transitions. Make the subscribe route + keygen unit-testable now; only on-device delivery is `[DEVICE-GATE]`.

### 1.2 Conversation view types bytes into a PTY, not a typed query — and can hit the wrong session (HIGH, effort L)
- **Where:** `packages/engine/src/conversationPage.ts:168-180,295-299` (typing path), `:279` (renders `sid` but injects into `paneId`)
- **Why it matters:** The vision calls the conversation view the *primary mobile surface*, but its input is byte-injection into the raw terminal. It inherits every terminal fragility (only works if a Claude TUI is focused at a prompt) and has no notion of "submit to session X." On the founder's own `claude`-in-a-shell setup (`sid` inferred ≠ `paneId`), a message read as a reply to session A can be injected as blind keystrokes into the foreground PTY — which may be a shell, executing the message as a command, with no guard. This is the most dangerous correctness gap on the most-trusted surface.
- **Direction:** Add a typed send path: an engine RPC that submits a prompt to a specific session via `ClaudeCodeAdapter` (resume/query), so the conversation view writes to `sid` rather than byte-injecting into `paneId`. Keep the byte-channel as an explicit fallback. **Minimum bar:** gate conversation-send when rendered `sid` != typing `paneId`, and surface that in the UI — not just the debug HUD.

### 1.3 Per-pane manual arming + 1h terminal-token TTL make away-typing impractical (HIGH, effort L)
- **Where:** `packages/desktop/src/Workspace.tsx:86-147`, `packages/engine/src/pairing.ts:92`
- **Why it matters:** For an away cockpit the founder can't walk to the desk to arm a pane, yet today (a) every pane the phone wants to type into must be manually armed *at the desktop* beforehand, and (b) the terminal (RCE) token expires in 1h and only rolls forward while a `/term-ws` socket is live — so a phone that backgrounds for an hour must re-pair. This is the pairing-friction wall. WS4 seamless pairing is the documented fix and is unbuilt; Termius/VibeTunnel/Blink all win partly on "it just stays connected."
- **Direction:** Implement WS4 — a longer-lived terminal token (the documented 30-day variant) with refresh that doesn't depend on a continuously-live socket, plus an opt-in auto-arm-on-attach mode (default-off, per-device enrolled, revocable) so the founder enrolls a trusted phone once instead of arming each pane each session. Keep the kill switch + audit log as the safety surface.

### 1.4 No lid-closed reachability — `caffeinate` doesn't stop clamshell sleep; `lidClosed()` RPC never built (HIGH, effort M)
- **Where:** `packages/desktop/src-tauri/src/keep_awake.rs:49-55`, `packages/engine/src/resizeAuthority.ts`
- **Why it matters:** The founder's away-mode is literally "lid closed, on charger, network-reachable." The shipped keep-awake can't deliver clamshell — the Mac sleeps on lid-close, dropping all reachability, discovered only back at the desk. There's also no lid/display-power detection, so `resizeAuthority` infers "desktop absent" from a 30s socket-quiet heuristic rather than a real signal. The central scenario is unsupported *and* resize hand-off is a timing guess. Omnara's whole cloud-handoff feature exists to solve exactly this; we can solve it locally without copying code to a vendor cloud.
- **Direction:** Ship the P1.7a display-power hook as a Tauri command emitting real lid/display-sleep state into a `LOCAL_ONLY` `lidClosed()` RPC, and feed it into `resizeAuthority` (replace the 30s-quiet proxy). Provide a guarded opt-in clamshell-keep-awake path with documented `pmset`/Amphetamine guidance in-app.

### 1.5 Tap-to-answer blindly assumes cursor row 0 — can mis-answer `AskUserQuestion` (MEDIUM, effort M)
- **Where:** `packages/engine/src/conversationPage.ts:265-271`
- **Why it matters:** Tap-to-answer is the killer mobile interaction, but the cursor math is unsound: if Claude pre-highlights a non-first option, the list scrolled, or it's `multiSelect`, the relative down-arrow count picks the wrong option — and the phone user can't see the TUI cursor (the conversation view ignores the byte mirror, `:174`). A wrong tap silently commits the wrong choice to a real session. Half-built, shipped on the surface the vision calls primary.
- **Direction:** Per Story 6.2, have the engine report the live highlighted index (or accept an absolute "select option N" intent it translates), so the phone selects by absolute target instead of guessing row 0. Disable/flag tap-to-answer for `multiSelect` until modeled. Until then, surface the assumption rather than committing silently.

---

## 2. Architecture debt — duplication and god-files around the security boundary (MEDIUM, mostly)

None of these are emergencies, but they concentrate on the most security-sensitive code and the new phone surfaces, which is the worst place for hidden drift.

### 2.1 Mirrored pure helpers have *already* drifted; the drift test pins only a subset (MEDIUM, effort M)
- **Where:** `packages/desktop/src/fuzzy.ts` vs `packages/engine/src/fuzzy.ts`; `packages/desktop/test/mirror-drift.test.ts`
- **Why it matters:** Four files (`fuzzy`, `keybindings`, `osc`, `notify`) are hand-duplicated across the engine/desktop boundary because the WebView can't import the Node-only SDK. The input path (`chordFromEvent` → keydown matching) is security-relevant — a bad chord match could leak terminal keys to app shortcuts — yet it is *not* in the drift battery. The "Change both" rule lives only in AGENTS.md, enforced by a partial behavioral test, not a structural one. A WebView-only edit to the matchers can diverge and ship green.
- **Direction:** Extract the genuinely-shared pure helpers into a tiny zero-dependency `@glaudecode/shared` (no SDK import) imported by both sides, eliminating duplication. If infeasible short-term, expand `mirror-drift.test.ts` to a property/fuzz battery over *every* exported function (including `chordFromEvent` and the full keymap) from a shared fixture, plus a CI structural signature check.

### 2.2 Terminal wire protocol reimplemented in three (really four) places with overlapping opcodes (MEDIUM, effort M)
- **Where:** `packages/engine/src/bridgeProtocol.ts`, `packages/engine/src/termProtocol.ts`, `packages/desktop/src-tauri/src/pane_bridge.rs`, plus an inline copy inside `packages/engine/src/termPage.ts`
- **Why it matters:** Two binary protocols (Rust↔engine, engine↔phone) each have a separate opcode table; the engine table is mirrored into Rust by hand. Adding/renumbering an opcode needs synchronized edits across a TS const, a Rust const block, a separate TS protocol, and an untyped JS string. Only the two TS codecs are tested; the Rust copy has 6 decode tests, the inline-JS copy has zero. The numeric overlap with divergent semantics is a latent footgun. A missed edit silently corrupts the keystroke/output channel with no compile error.
- **Direction:** Define opcode tables once (small schema/JSON or generated header) and code-gen the Rust constants + a typed TS codec. Minimum: a CI assertion that Rust `OP_*` == `bridgeProtocol.ts` `BridgeOp`, plus a `termPage` codec test round-tripping the inline JS against `termProtocol.ts`.

### 2.3 Served phone pages are ~1100 lines of untyped JS in template strings (MEDIUM, effort L)
- **Where:** `packages/engine/src/conversationPage.ts` (511 lines), `packages/engine/src/termPage.ts` (631 lines), `packages/engine/src/cockpit.ts` (278 lines)
- **Why it matters:** The phone surfaces — the *primary* product per the V6 pivot — carry the most logic-dense, security-sensitive code (paste boundary stripping, ctrl-key encoding, HTML escaping, WS auth) yet live as opaque strings the TS compiler and test runner can't see. The paste/ctrl logic is duplicated from the tested engine copies, so a fix to `termInput.ts` (`wrapForPaste`/`ctrlByte`) silently never reaches the phone — the live paste-jacking guard is a hand-copied, tsc-invisible string. Highest maintainability hazard in the codebase.
- **Direction:** Move the served-page client JS into real `.ts` files compiled (esbuild/Bun) to a string asset at build time, so `tsc` + lint + unit tests cover them and `wrapForPaste`/`ctrlByte`/`esc` are *imported* from the tested modules. Add a `termPage` runtime test (jsdom/Bun DOM) for paste-wrap, ctrl encoding, and WS auth-frame ordering.

### 2.4 `lib.rs` is a 1160-line god-file owning 7 subsystems, with the RCE gate buried inside (MEDIUM, effort L)
- **Where:** `packages/desktop/src-tauri/src/lib.rs`
- **Why it matters:** The single most security-critical Rust code — the authoritative per-pane arming gate that authorizes remote code execution into the PTY — sits in the same file as Tailscale subprocess plumbing and a vendored shell-plugin string. The noted lock-ordering risk (armed-then-panes one way, panes-then-armed another) is exactly the bug an oversized file hides. Mixed concerns block focused testing; there are zero tests on the spawn/supervise lifecycle or the hostile-input decode path.
- **Direction:** Split into focused modules: `pty.rs`, `arming.rs` (the gate + `is_armed`, own unit tests, one documented lock order), `engine_supervisor.rs`, `tailscale.rs`, `shell_integration.rs`, `approval_hook.rs`. The arming gate especially deserves isolation + dedicated tests since it's the RCE boundary.

### 2.5 `rpc.ts` is an 827-line dispatcher; unclassified methods default to `steer` (mutating) (LOW, effort M)
- **Where:** `packages/engine/src/rpc.ts`
- **Why it matters:** Routing, auth/scope, validation, derived-state computation, and side-effects all sit behind a 68-case switch. The scope classifier's default is fail-*open*-to-`steer` — an unclassified method should be *denied*, not granted steer. If the exhaustiveness CI test is ever disabled, a new sensitive RPC added without a scope entry silently becomes reachable by any paired steer-scope phone. Low severity today (the CI test holds), but it inverts the safer fail-closed posture on the highest-trust file.
- **Direction:** Make scope a required property *of* each method via a single `Record<RpcMethod, {scope, handler, validate}>` registry the type-checker enforces (compile-time exhaustiveness), so a method can't exist without a declared scope. Change the `methodScope` default to throw/deny. Split derived-state handlers out of dispatch.

---

## 3. Test coverage — the safety surfaces are untested (HIGH where it counts)

The pattern: the *pure* logic is well-tested (~50 engine test files), but every **stateful, security-bearing, user-facing** surface — the React arm/kill UI, the Rust PTY/supervisor core, the phone JS — has near-zero behavioral coverage. These are precisely the things the 2026-06-15 audit and the founder's observability mandate care most about.

### 3.1 Entire desktop React app (5167 LOC) has zero component tests — including arm/kill safety UI (HIGH, effort M)
- **Where:** `packages/desktop/src/App.tsx`, `Workspace.tsx`, `RemoteArmedChips.tsx`, `PairingModal.tsx`
- **Why it matters:** The arm/kill "safety surface" is exactly what the 2026-06-15 audit named the *single most important fix* (kill-switch can no-op; arm UI desyncs from Rust on reload). It lives entirely in untested React. A regression turning the kill switch into a no-op, or showing the armed indicator "off" while a pane stays live to remote RCE, would pass CI. This is a correctness/safety gap, not cosmetic — and it's the audit's top finding.
- **Direction:** Add vitest + @testing-library/react with happy-dom, mocking the engine at the `engine.ts` RPC boundary. Prioritize three tests: (1) `RemoteArmedChips` kill-switch actually invokes `pty_disarm_all` and the indicator reflects `listArmed()` + `armed-changed` events; (2) `Workspace` arm-toggle round-trip; (3) `PairingModal` refuses to mint a terminal token without both consent gates.

### 3.2 Rust core: tests cover only the pure `is_armed()` predicate (MEDIUM, effort L)
- **Where:** `packages/desktop/src-tauri/src/lib.rs`
- **Why it matters:** The Rust core is the authoritative owner of PTYs and the arming gate, and the supervisor that keeps the engine alive for the hours-long lid-closed sessions. Untested behaviors with real failure history: engine respawn retiring the old stop flag before the new pump spawns (the orphan bug that blanked the mobile mirror), `pty_write_internal` lock ordering, and `SERVE_ACTIVE` under concurrent serve start/stop. A regression here is invisible until a long lid-closed session silently dies.
- **Direction:** Refactor the supervisor/respawn sequencing into pure-ish decision functions (mirroring how `is_armed()` was extracted) and unit-test them; add tests for the lock-ordering invariant, `SERVE_ACTIVE` transitions, and a pump-liveness test that a stop-flag flip actually exits the old pump before reassigning the input bridge.

### 3.3 Served phone JS (1140 LOC of behavior) is never executed in tests (MEDIUM, effort L)
- **Where:** `packages/engine/src/termPage.ts`, `packages/engine/src/conversationPage.ts`; current guards in `conversationPage.test.ts`, `termInput.test.ts`
- **Why it matters:** The two largest pieces of attacker-facing, `AskUserQuestion`-answering, RCE-input-bearing code in the product have *zero behavioral tests* — existing tests only confirm the template compiles and contains certain substrings. A regression making `renderSmartQ()` send the wrong option index, breaking the ACK flow-control (re-stalling the mirror — the exact bug class already root-caused on mobile), or mis-mapping a puck wedge would ship green. Highest-value gap given "silent failure is the enemy." (Pairs with 2.3 — the fix is the same extraction.)
- **Direction:** Extract the inline `<script>` bodies into importable pure modules (or use jsdom/happy-dom in Bun) and unit-test the load-bearing functions: `renderSmartQ()` option-index correctness, `ctrlByte()` mapping, the flow-control ACK scheduler, and the puck wedge→key map. Minimum: a `termPage.test.ts` mirroring the existing parse guard, then promote DOM-building functions to testable units.

### 3.4 Session-inference heuristic (the V6 `paneId≠sessionId` fix) is untested (LOW, effort M)
- **Where:** `packages/desktop/src/App.tsx`, `packages/engine/src/projectRoot.ts`; only the static git-root walk is covered (`projectRoot.test.ts`)
- **Why it matters:** Brand-new V6 code that exists *because* the founder runs `claude` inside a shell. With two stale sessions in a shared dir there's no tiebreaker, and once `locked` it stays locked even after the cwd changes to a project with no sessions — so dock actions (rename/compare/handoff) can fire against a session from a *different* project. Worst-case cross-project misfire is already mitigated by the effect's cwd dependency, hence LOW — but it's cheaply testable and currently 0%.
- **Direction:** Extract the inference decision into a pure function (input: session summaries + mtimes + cwd + currently-locked id; output: next inferred `{sessionId, dir} | null`) and unit-test: empty → null, single fresh → locks, two fresh → deterministic tiebreaker, stale (>LIVE_WINDOW) → no lock, cwd-change-to-empty-project → unlock rather than persist.

---

## 4. Competitive read — where the gaps cost us, where we still lead

Cross-checking the gaps against the landscape sharpens which ones are existential vs. cosmetic.

- **Push (1.1) is table stakes, not a nice-to-have.** Omnara, Cursor cloud agents, and the DIY `ntfy` crowd all treat "your phone buzzes when the agent needs you" as the core of away-mode. Blink Shell's *explicit* #1 weakness is no push. Shipping it is how "monitor" becomes "get pulled in only when needed." This is the single highest-leverage gap to close.
- **Lid-closed (1.4) is Omnara's headline (cloud handoff) — we can match it privately.** Omnara copies your uncommitted code into *their* cloud to keep the agent alive. Keeping the engine alive on the user's own Mac over Tailscale delivers the same benefit with no privacy tradeoff — but only once clamshell sleep is actually solved.
- **The conversation view (1.2) is our wedge vs. VibeTunnel/Blink/Termius/DIY** (all raw-terminal-on-touch, which every reviewer calls awful). But a render veneer that types into the wrong PTY is *worse* than no conversation view — fix the typed-send path before marketing it as primary.
- **Where we genuinely lead and should protect:** own-infra/own-Tailscale privacy (vs. Omnara/Warp/Termius cloud round-trips and Warp's telemetry history); the conversation + one-tap raw-terminal dual surface (no competitor pairs both); Claude-Code integration *depth* via the Agent SDK (everyone else is agent-agnostic and shallow); and the scoped-token + per-pane-arming + audit security model (vs. VibeTunnel's auth grab-bag and DIY's `--dangerously-skip-permissions` culture). These are real moats — the gaps above are what's blocking us from being able to *use* them away from the desk.

---

## Priority summary

| # | Gap | Severity | Effort |
|---|-----|----------|--------|
| 1.1 | No push pipeline | HIGH | L |
| 1.2 | Conversation view byte-injects into wrong PTY | HIGH | L |
| 1.3 | Per-pane arming + 1h token (WS4 unbuilt) | HIGH | L |
| 1.4 | No lid-closed reachability | HIGH | M |
| 3.1 | React arm/kill UI untested | HIGH | M |
| 1.5 | Tap-to-answer assumes cursor row 0 | MEDIUM | M |
| 2.1 | Mirrored helpers drifting | MEDIUM | M |
| 2.2 | Wire protocol in 4 places | MEDIUM | M |
| 2.3 | Phone pages untyped JS strings | MEDIUM | L |
| 2.4 | `lib.rs` god-file | MEDIUM | L |
| 3.2 | Rust core untested | MEDIUM | L |
| 3.3 | Phone JS untested | MEDIUM | L |
| 2.5 | `rpc.ts` fail-open scope default | LOW | M |
| 3.4 | Session inference untested | LOW | M |

**If only three things get done:** ship push (1.1), make conversation-send typed-and-safe (1.2), and test the arm/kill safety UI (3.1). The first two make the away cockpit real; the third stops the audit's top safety risk from regressing silently.
