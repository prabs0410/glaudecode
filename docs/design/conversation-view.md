# Conversation View — V6 Phase 6 (LATER / optional upgrade-on-top)

**Status:** Design for the autonomous loop. **DEFERRED** — the last phase; built only after Phases 1–5 (mobile-native terminal, Tailscale Serve HTTPS, PWA push, clipboard both tiers) are green. Low urgency for the founder, who delegates review.
**Depends on:** Phase 1 (mobile-native terminal — the fallback target), the existing TYPED data path (already shipped V1/V2). No transport dependency of its own.
**V5 analogue:** the cockpit's Mode-C "Smart" tab in `packages/engine/src/termPage.ts:83` (`renderSmartQ`, `pollPromptState`) is the seed of this surface — this phase **promotes and hardens** it, it does not start from scratch. Companion design docs: `mobile-native-terminal.md` (Phase 1), `pwa-push.md` (Phase 3), `clipboard-bridge.md` (Phases 4–5). The wider epic: `epic-g-cockpit.md`, `epic-g-remote-threat-model.md`.

> **Non-negotiable framing.** The **raw terminal mirror is the trusted core** — it renders every Claude approval / prompt / TUI variation natively (the exact thing the company-account remote control fails at). This conversation view is an **upgrade-on-top**: a friendlier default surface for the common case, with the **raw terminal one tap away** and an **automatic fallback** for anything the structured surface can't render faithfully. **This phase must NEVER remove, hide-by-default, or weaken the terminal.** If in doubt, fall back to the terminal.

---

## 1. Problem & user value

The mobile job-to-be-done is *supervise + approve + answer* across ~4–5 sessions, voice-first, away from the desk. The raw mirror (Phases 1–2) makes that **possible**; it does not make it **pleasant**: a ~45-column VT100 grid is a compromise on a phone, and the single highest-frequency action — answering an `AskUserQuestion` — still routes through fragile cursor sequences (see §6.2 / `renderSmartQ`, `termPage.ts:216`).

The user value of a conversation view: for Claude panes, show the session as **reflowing message bubbles + a live status chip + a pinned tap-to-answer card**, so the common case (read what it did, answer its question, send a follow-up) needs no horizontal scrolling, no arrow-key cursor math, and no zoom. The terminal stays one tap away for everything structured rendering can't faithfully show (vim, htop, raw ANSI, a permission-mode TUI variant we don't model).

**Felt-improvement test (Principle II):** answering a question by tapping a button that *reliably* selects the right option — including a pre-selected default and multi-select — is a real daily-friction win. A full chat re-render that's merely "prettier" is not, and is explicitly scoped low. **Build 6.2 (the tap-to-answer hardening) even if 6.1/6.3 slip** — it's the one item that fixes a *correctness* bug, not just polish.

---

## 2. Research (reuse, don't re-derive)

- **`docs/research/mobile-cockpit-ux-2026-06-17.md`** — the load-bearing finding: *a Claude-native structured surface does **NOT** require parsing ANSI/TUI bytes.* The engine already has a separate **typed** path (`adapter.getSessionMessages()` → typed `text`/`thinking`/`tool_use`/`tool_result` blocks via `mappers.ts`), and `promptState.ts` / `agentState.ts` / `changes.ts` already consume it — so this surface is "~80% built" and adds **zero ANSI parsing**. The real gating risks named there are **JSONL freshness / poll latency** (3 s today) and the **worktree `paneId===sessionId` identity** caveat — *not* parseability.
  - **Direction B** (full Claude-native conversation cockpit; terminal becomes an explicit fallback) is the destination this phase moves *toward*. **Direction C** (hybrid: terminal canvas + a thin agent layer on top — pinned answer card, status chip) is what we actually ship here, because the research's recommendation is explicitly *"table-stakes → C → evolve to B."* This doc is the C→B step, scoped conservatively.
  - Two corrections from that doc are folded in: **(2) harden tap-to-answer before promoting it** (§6.2), and **the structured layer needs no new VIEW/STEER widening** beyond §6.2's select-intent (its critique: C "does not widen the Epic-G remote threat-model surface").
- **`docs/research/mobile-platform-transport-clipboard-2026-06-17.md`** — confirms the pure-PWA-forever decision and the alert-then-act loop; this surface is rendered from the same served page, no native render path. Diffs are noted there as a marquee differentiator but the founder rates them **low priority** (delegates review) → §6 diffs are **optional**.

---

## 3. Architecture (concrete)

### 3.1 What already exists (reuse verbatim — change nothing in the engine for 6.1/6.3)

- **Typed read path** — all `VIEW_METHODS` (`rpc.ts:186`), so a paired **view-scope** token can already call every one of these remotely with no new surface:
  - `getSessionMessages` (`adapter.ts:47`) → `SessionMessage[]` with `blocks: ContentBlock[]` (`types.ts:40`).
  - `promptState` (`promptState.ts:33`) → `{ askUserQuestion, isWaiting }`.
  - `agentState` (`agentState.ts:26`) → `{ status: "idle"|"thinking"|"running-tool", toolName?, model?, sinceMs? }`.
  - `sessionChanges` (`changes.ts:22`) → `ChangeEntry[]` (the optional diff/changes strip, §6.4).
- **The Smart-tab seed** in `termPage.ts`: the `#tab-smart` button (`termPage.ts:83`), `#panel-smart`/`#smart-q` container, `pollPromptState()` (`termPage.ts:210`), `renderSmartQ()` (`termPage.ts:216`), and the 3 s `setInterval(... pollPromptState ...)` (`termPage.ts:452`). The `DIR` resolution and `paneId===sessionId` mapping (`termPage.ts:206-208`, `267`) are reused.
- **The terminal mirror** (`#term`, the `/term-ws` socket, `paneHub.ts` ring/replay) — the fallback target; untouched.

### 3.2 What 6.1 adds — a structured **default surface** on the served page

A new **"Chat"** mode for a Claude pane in `termPage.ts`, rendered entirely client-side from the typed RPCs (no engine change):

- **Mode model.** The page already has `Message | Smart` tabs (`termPage.ts:81-84`). Add a third surface **Chat** that, *for a Claude pane only*, becomes the **default landing view**; **Terminal** is always present as a tab/toggle (the `⇄` switch already exists at `termPage.ts:78`). Persist the user's last chosen surface per-pane in **localStorage** (matches the Phase-1 prefs decision; survives PWA cold-start). A non-Claude pane (plain shell) has **no** Chat surface — it lands on Terminal.
- **Render loop.** Poll `getSessionMessages({ id: paneId, dir: DIR, options:{ limit } })` on the same 3 s cadence as the existing prompt poll (reuse the one `setInterval` at `termPage.ts:452`; do **not** add a second timer). Map the typed blocks to DOM:
  - `text` (assistant) → an assistant bubble; `text` (user) → a user bubble.
  - `thinking` → a collapsed "thinking" disclosure (collapsed by default, low signal on a phone).
  - `tool_use` → a one-line **tool card** (`name` + a short summarized input, e.g. `Edit · src/foo.ts`); `tool_result` (matched by `toolUseId`) flips the card to done/error (`isError`).
  - **Render with `textContent`, never `innerHTML`** (the existing `renderSmartQ` rule, `termPage.ts:233`) — model output is untrusted.
- **Append-only diffing.** Key bubbles by `SessionMessage.id`; only append new messages (don't rebuild the list each poll) so scroll position and an in-flight answer aren't lost — the same "don't rebuild on unchanged" discipline as `renderSmartQ` (`termPage.ts:220`).
- **Auto-fallback (the safety valve).** Detect when the structured surface is **insufficient** and surface a prominent "Open terminal" affordance (and, on a hard signal, auto-switch). Triggers:
  - `getSessionMessages` returns empty / errors, OR the pane isn't a Claude session (no typed stream).
  - The session is `running-tool` on an interactive TUI we don't model (e.g. a nested `claude` plan-mode picker that isn't an `AskUserQuestion`/`ExitPlanMode`) — i.e. `isWaiting` true but `askUserQuestion === null` (an `ExitPlanMode`, `promptState.ts:53`): show the answer affordance **but** keep "this needs the terminal" guidance.
  - The worktree identity caveat fires (§5): `promptState`/`getSessionMessages` for `paneId` returns nothing while the terminal clearly shows activity → fall back to terminal, don't pretend the session is idle.

### 3.3 What 6.2 adds — reliable tap-to-answer (the one engine change in this phase)

A new **`selectPromptOption`** intent so the engine, not the page, owns option-selection. See §4 and §6.2. This is the only new RPC; it is classified **steer** (it mutates the live session) and is *also* mirror-able into the existing `/term-ws` INPUT path as a fallback. The page's `renderSmartQ` answer buttons (`termPage.ts:243`,`258`) call this intent instead of computing `down-arrow × index`.

### 3.4 What 6.3 adds — a status chip

Bind a persistent status chip (reusing the existing `#pill`, `termPage.ts:78`, `setPill`, `termPage.ts:269`) to `agentState.status`: `thinking` → "Claude is working", `running-tool` → "Running <toolName>", `idle` → "Idle" / "Waiting for you" when `promptState.isWaiting`. Drives the same poll; no new RPC. (`cockpit.ts` already joins panes to `agentState` for the session-list dots, `cockpit.ts:217`,`230` — the per-pane chip is the same data, one level down.)

### 3.5 Control/data flow (one pane, Chat surface)

```
phone PWA (termPage Chat surface)
  │  every 3s (shared timer, termPage.ts:452):
  ├─ rpc getSessionMessages {id:paneId, dir:DIR}  ─► engine ─► ClaudeCodeAdapter (Principle XI) ─► append bubbles/tool cards
  ├─ rpc promptState        {id:paneId, dir:DIR}  ─► engine ─► render/refresh the pinned answer card
  └─ rpc agentState         {id:paneId, dir:DIR}  ─► engine ─► status chip (#pill)
  │  on tap-answer:
  └─ rpc selectPromptOption {id:paneId, dir:DIR, optionIndex|labels, submit} ─► engine derives target from LIVE highlight ─► /term-ws INPUT to PTY
  │  on "Open terminal" (always available) / auto-fallback:
  └─ switch to #term  (existing /term-ws mirror — the trusted core, unchanged)
```

All Claude Code access stays behind `ClaudeCodeAdapter` (Constitution Principle XI); the page never reads `~/.claude` JSONL directly.

---

## 4. Data model / protocol

**No new domain types for 6.1/6.3** — they consume the existing `SessionMessage`/`ContentBlock` (`types.ts:40`), `PromptState` (`promptState.ts:22`), `AgentState` (`agentState.ts:14`).

**6.2 — one new RPC + one engine-computed field.** The engine must be able to report the **live highlighted index** so the page never *assumes* row 0.

```ts
// promptState.ts — extend PromptState (additive; undefined when not derivable)
interface PromptState {
  permissionMode?: "plan" | "acceptEdits" | "normal" | "bypassPermissions";
  askUserQuestion: PromptQuestion | null;
  isWaiting: boolean;
  highlightedIndex?: number;   // NEW: the option the TUI currently has highlighted, if observable; else undefined
}

// New steer RPC (rpc.ts: RpcMethod union + METHODS set + STEER_METHODS + dispatch case + client wrapper + index.ts export)
type SelectPromptOptionParams = {
  id: string; dir: string;
  optionIndex?: number;        // single-select: absolute target index
  labels?: string[];           // multiSelect: the option labels to have ON before submitting
  submit: boolean;             // false = move/toggle only (multiSelect staging); true = press Enter after
};
type SelectPromptOptionResult = { ok: true; sentFrom: number } | { ok: false; reason: "no-question" | "unobservable-highlight" | "stale" };
```

- **Semantics.** The engine reads the current `PromptState` for the pane, computes the *delta* from the **live highlighted index** (not a hardcoded 0) to the requested target, and emits the equivalent key sequence to the PTY via the **same authenticated `/term-ws` INPUT path** the terminal already uses (terminal-scope + armed pane gate, `server.ts` `gateTerminal`, `server.ts:140`). For `multiSelect`, it toggles each requested label to ON and submits once only when `submit:true`. If the highlight isn't observable, it returns `unobservable-highlight` and the page **falls back to the terminal** rather than guessing.
- **Why an RPC and not pure client math:** the `paneId===sessionId`/`DIR` resolution and the highlight derivation both live engine-side already; centralizing the select logic means one tested implementation (not a JS mirror that can drift) and a single audited entry point. **Scope = steer** (it's an `AskUserQuestion` answer — exactly what steer is for, `STEER_METHODS`, `rpc.ts:196`), and the actual PTY write still passes the terminal RCE gate. The 7.2.2 "every method lands in exactly one tier" CI test must include it.

**Protocol:** no new `/term-ws` opcode — `selectPromptOption` reuses the existing `INPUT` frame (`termProtocol.ts:41`) for the resulting bytes. The 3 s poll cadence and the `/ws` event stream are unchanged.

---

## 5. Edge cases & failure modes

- **Worktree identity caveat (the named risk).** `promptState`/`getSessionMessages` key on `paneId===sessionId`; a session running in a **different-cwd worktree** won't resolve (`promptState.ts` header; `termPage.ts:207-208`). Behavior: when the typed stream is empty but the terminal shows activity, the Chat surface must **fall back to the terminal**, never render a misleading "idle/empty" chat. Flag the worktree pane as "terminal-only" in the UI. (Fixing the identity mapping itself is out of scope for Phase 6.)
- **JSONL freshness / 3 s poll latency.** Chat can lag the terminal by up to one poll. The terminal mirror is real-time; so the answer card must reconcile (see next). Acceptable for read; **not** acceptable for an answer.
- **Stale answer (the dangerous one).** Between poll and tap, the question may already be answered (e.g. answered at the desk, or auto-resolved). `selectPromptOption` must re-derive `promptState` server-side at execution time and return `stale`/`no-question` if there's no outstanding question — **never** blind-send arrow+Enter into whatever the PTY now shows. The page clears the card on `stale`.
- **Pre-selected default (the silent-wrong-answer bug).** Today `renderSmartQ` assumes the highlight starts at row 0 (`termPage.ts:259`); a TUI that pre-selects a non-zero default silently confirms the wrong option. §6.2's live-highlight derivation fixes this; if the highlight is unobservable, fall back to terminal (don't guess).
- **multiSelect.** Today's path toggles relative to an assumed cursor and a separate Confirm (`termPage.ts:240-254`) — fragile. §6.2 makes the engine own toggle-to-target + single submit; `submit:false` stages, `submit:true` commits.
- **Untrusted model output.** Bubble/card text is rendered with `textContent` only (no `innerHTML`) — option text already follows this (`termPage.ts:233`); the same rule covers all bubbles, tool inputs, and thinking blocks.
- **Two clients answer one question.** Same "first write wins" as approvals (`epic-g-cockpit.md` §5); the loser sees `stale`.
- **ExitPlanMode / unmodeled prompts.** `isWaiting:true` with `askUserQuestion:null` (`promptState.ts:53`) → show "needs the terminal to answer" + the terminal toggle; don't render fake buttons.
- **Non-Claude pane.** No typed stream → no Chat surface → lands on Terminal (§3.2).

---

## 6. Security (RCE-adjacent — be specific)

- **No new remote surface for 6.1/6.3.** They consume only `VIEW_METHODS` (`getSessionMessages`/`promptState`/`agentState`/`sessionChanges`), which a **view-scope** paired token can already call. The structured surface does **not** widen the Epic-G threat model (per the research critique).
- **`selectPromptOption` is the one new powered path** and must be gated like every steer/RCE action:
  - **Scope = steer**, explicitly listed in `STEER_METHODS` (`rpc.ts:196`); the 7.2.2 CI test asserts it lands in exactly one tier (a view token gets it rejected).
  - The resulting PTY write goes through the **existing `/term-ws` INPUT gate** — `gateTerminal` requires **terminal scope + live (re-verified) token + an armed pane** (`server.ts:140`, `server.ts:367`), and the Rust core re-checks arming before writing (defense in depth). A steer-but-not-terminal token can *intend* a selection but the bytes still won't reach the PTY unless the pane is armed — i.e. answering a question is as gated as typing.
  - **Re-derive at execution time** (the `stale` guard, §5) so a selection can never be replayed into an unrelated later prompt — a confused-deputy / replay defense for an RCE channel.
  - **Audit:** record the selection on the existing audit trail (the `INPUT` audit records paneId + byte count, never bytes — `server.ts:133`); `selectPromptOption` should likewise audit `{paneId, optionIndex|labelCount, submit}`, never free-text.
- **Untrusted-render rule** (`textContent` only) prevents stored-XSS from a malicious tool result / model output into the cockpit DOM.
- **No instruction-file or memory writes** from this surface (those are `LOCAL_ONLY_METHODS` soft-RCE, `rpc.ts:222`) — unaffected and must stay that way.
- **The terminal stays the trusted core:** if any gate or derivation is uncertain, the surface falls back to the raw mirror, which has its own, already-reviewed gate.

---

## 7. Test plan

**Machine-verifiable (the per-commit gate: engine `bun test` · `tsc` per package · `vite build` · `cargo check`/`cargo test`):**
- `promptState` highlight derivation: unit tests over synthetic `SessionMessage[]` — pre-selected non-zero default → correct `highlightedIndex`; unobservable → `undefined`. (Pure, `packages/engine`.)
- `selectPromptOption` dispatch: single-select target index, multiSelect labels→toggle set, `submit:false` vs `true`; returns `no-question`/`stale`/`unobservable-highlight` on the respective inputs.
- Scope classification: a CI assertion (extend the 7.2.2 test) that `selectPromptOption ∈ STEER_METHODS` and a **view** token is **403**'d; the PTY write still requires terminal-scope + armed (assert rejected when not armed).
- Untrusted render: a unit/DOM test that an option label / tool input containing `<img onerror=...>` is rendered as text (no element created).
- Mirror parity: if any `wrapForPaste`/byte-sequence logic is duplicated into the page, assert the engine and `termPage.ts` mirror match (the existing mirror-parity discipline).
- Builds/typecheck green on the phase branch before any later work.

**`[DEVICE-GATE]` (founder, Android over Tailscale Serve HTTPS — cannot be CI'd):**
- Chat surface renders a real multi-turn session as bubbles; thinking collapsed; tool cards flip to done.
- Tap-to-answer selects the **correct** option for (a) a row-0 default, (b) a **pre-selected non-zero default**, (c) a **multiSelect** with 2 toggles — verified by what Claude actually received.
- A question answered at the desk mid-poll → the phone card clears (`stale`), no stray keystrokes.
- A vim/htop/worktree pane → auto-fallback to the terminal works and is obvious.
- Status chip tracks working / running-tool / idle / waiting-for-you.

---

## 8. Acceptance criteria

- For a Claude pane, the cockpit **defaults to** a reflowing conversation surface (bubbles + tool cards + status chip) rendered from the typed path, with **zero ANSI parsing**; the **raw terminal is one tap away at all times** and is the **automatic fallback** for empty/errored/worktree/TUI cases. A non-Claude pane lands on the terminal.
- **Tap-to-answer is correct, not assumed:** the engine derives the live highlight and selects the requested option for single-select (incl. a non-zero default) and multiSelect, or cleanly refuses (`stale`/`unobservable`) and falls back — it never silently confirms the wrong option.
- `selectPromptOption` is steer-scoped, passes the terminal-scope + armed gate for the actual PTY write, re-derives at execution time, and is audited content-free.
- The terminal is never removed, hidden-by-default for a pane that needs it, or weakened. All per-commit gates green on the `feat/v6-p6-*` branch; **no PR / no merge**; commits attributed to `prabs0410`.

---

## 9. Open questions

1. **Surface default per pane:** Chat-by-default for *all* Claude panes (recommended), or keep Terminal-default and let Chat be opt-in until it's proven on-device? (Founder review-delegation suggests Chat-default is fine, but it's a behavioral change to the trusted surface.)
2. **Highlight observability:** can the engine reliably read the TUI's current highlighted index from the typed/persisted stream, or does it need a peek at the `paneHub` ring (`paneHub.ts`, the live screen bytes)? If the typed path can't see the highlight, §6.2 falls back to "select only when highlight==0 is safe, else terminal" — confirm that's acceptable as the v1 of the hardening, or whether scraping the ring is in scope.
3. **Diffs (6.4, optional):** founder rates diffs low (delegates review). Ship the `sessionChanges` strip as a thin read-only list now (cheap — view-scoped, already computed, `changes.ts`), or defer entirely? `gitDiff`/`sessionChangesGit` are also already `VIEW_METHODS` if a native diff card is ever wanted.
4. **Poll vs `/ws` push:** keep the shared 3 s poll for Chat, or move the conversation surface onto the existing `/ws` event stream for lower latency (the research preferred event-push)? Poll is simpler and matches today's Smart tab; push is a follow-up.
5. **Worktree identity:** Phase 6 *flags* worktree panes terminal-only. Is fixing the `paneId===sessionId` mapping in scope here, or a separate item? (It gates structured reliability for multi-cwd work.)
