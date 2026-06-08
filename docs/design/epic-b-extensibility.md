# Epic B — Extensibility (Lifecycle Hooks, Extensions, Meta-Agent)

**Status:** Draft for review
**Depends on:** V1 engine; Epic A (meta-agent needs multiple live sessions)
**Conventions:** ADR 0002 (lifecycle event taxonomy, jiti extensions)

## 1. Problem & user value
The OSS/hackable angle is one of the three open wedges from the viability research (Anthropic's app
is closed; opcode is GUI-only). GlaudeCode should let users **script and extend it**: run code on
session lifecycle events, add their own panels/commands, and run an **advisory meta-agent** that
watches across sessions. This is the "make it yours" promise of Principle I.

**Felt-improvement test:** neither incumbent offers a hookable, scriptable terminal for Claude Code.
This is genuinely differentiated — *if* it's safe and low-friction.

## 2. Research / constraints
- **ADR 0002** already locked the event taxonomy: `session_start` (reason new/resume/fork/startup),
  `session_before_fork`, `session_before_switch`, `session_before_compact`, `session_compact`,
  `session_shutdown`, plus GC cross-session events (`session_forked_to_worktree`,
  `session_merged_from_peer`, etc.).
- **jiti** runs `.ts` with no build step (ADR 0002) — extensions are plain `.ts` files in the Bun
  sidecar. Good DX.
- **The hard problem is sandboxing** (flagged in viability research): a jiti-loaded extension runs
  with full sidecar privileges (filesystem, network, spawn). Untrusted extensions = RCE. Options:
  - **Trusted-only (V2 default):** user-installed local `.ts` only; no registry, no auto-fetch.
    Documented as "extensions run with your privileges, like a shell rc file."
  - **Worker isolation:** run each extension in a `Worker`/`utilityProcess` with a *capability-limited*
    API surface (message-passing only, no raw `fs`/`net`). Real sandboxing; more work.
  - **isolated-vm / Bun's permission model:** stronger but heavier; revisit pre-1.0.
- **Meta-agent uses SDK `query`** → draws the separate SDK credit pool (June 2026 billing). It must
  be opt-in and budget-aware (ties to Epic C budgets).

## 3. Architecture
### 3.1 EventBus (engine)
A typed emitter in the engine. The orchestrator (Epic A) and adapter emit lifecycle events; the
EventBus fans them to (a) the WebView (for UI reactions) and (b) the ExtensionHost.

### 3.2 ExtensionHost (engine, Bun sidecar)
- Discovers `~/.glaudecode/extensions/*.ts` and `<repo>/.glaudecode/extensions/*.ts`.
- Loads each via jiti; an extension exports `register(api)` where `api` lets it subscribe to events,
  register commands, and (later) contribute panels.
- **V2 isolation decision:** start **trusted-only, in-sidecar** (documented risk), with the API
  surface designed so a future move to Worker isolation doesn't change extension code. Sandboxing is
  a tracked **pre-1.0 security gate** (Principle XI mindset applied to our own surface).

### 3.3 Meta-agent (engine)
An opt-in background loop: every N seconds (or on events), reads active sessions (via the adapter +
V1 computed views — agentState, changes, timeline) and produces **observations**:
- "session 3 idle/stuck 5 min" (from agentState + sinceMs)
- "sessions 1 & 4 edit the same file" (reuses Epic A ConflictDetector)
- "session 2 finished — summary available"
Optionally uses SDK `query` for richer natural-language digests (credit-aware, off by default).
**Advisory only** — it surfaces; it never acts autonomously (it *can* suggest a handoff, which the
user confirms).

## 4. Data model
```ts
type LifecycleEvent =
  | { type: "session_start"; sessionId: string; reason: "new"|"resume"|"fork"|"startup" }
  | { type: "session_before_fork"|"session_before_switch"|"session_before_compact"
      | "session_compact"|"session_shutdown"; sessionId: string }
  | { type: "session_forked_to_worktree"|"session_merged_from_peer"; sessionId: string; peer?: string };

interface ExtensionApi { on(type, handler): void; registerCommand(id, fn): void; log(msg): void }
interface Observation { id: string; level: "info"|"warn"; text: string; sessionIds: string[]; at: string }
```

## 5. Edge cases & failure modes
- **A bad extension throws on load** → isolate the failure, disable that extension, surface the error;
  never crash the engine.
- **Extension infinite loop / blocks** → time-box handlers; a misbehaving extension can't freeze the
  host (Worker isolation makes this enforceable — another reason to design the API message-based).
- **Meta-agent runaway cost** → hard budget cap (Epic C); off by default; show its spend.
- **Event storms** (many sessions) → debounce/batch event delivery.

## 6. Security
- **Extensions are trusted code by default** — documented prominently; treated like a shell rc.
- API surface is intentionally narrow and designed to be enforceable under Worker isolation later.
- No remote extension fetch/registry in V2 (removes the supply-chain vector entirely).
- Meta-agent network use is only the Anthropic API via the SDK; no other egress.

## 7. Test plan
- **Unit:** EventBus subscribe/emit/unsubscribe; Observation generation from fixture session states;
  ConflictDetector reuse.
- **Integration:** load a sample extension that subscribes to `session_start` and asserts it fires.
- **Manual:** meta-agent observations surfacing; extension-failure isolation.

## 8. Acceptance criteria
- A sample `.ts` extension reacts to a real lifecycle event (e.g. logs on `session_start`).
- A bad extension fails in isolation without taking down the engine.
- The meta-agent surfaces ≥1 real cross-session observation; is off by default; shows its cost; never
  acts without confirmation.

## 9. Open questions (for review)
1. **Sandboxing now or later?** Recommend: trusted-only for V2 (ship the hackability), Worker
   isolation as a pre-1.0 gate. Accept the documented risk? (Founder call.)
2. **Extension API surface** — events + commands only for V2, or also contributed panels (bigger)?
3. **Meta-agent default cadence + whether it may use SDK `query`** (cost) or stay rule-based only.
