# GlaudeCode — Goal & Autonomous-Build Backlog

> This file is the single target an autonomous build loop works against. It pairs the north-star
> with a structured, testable V1 backlog and the hard guardrails any automated agent MUST obey.
> Status of the foundation: VERIFIED (Tauri+xterm.js+PTY runs Claude Code; Agent SDK reads/forks
> sessions — see `docs/research/technical/spike-*.md`).

---

## North-Star

**GlaudeCode is the open, terminal-native home for Claude Code: a desktop terminal you actually
live in, built so that everyday Claude Code work becomes visible, controllable, and orchestratable
instead of scattered and opaque.**

It wraps Claude Code in a terminal that *shows you the work* — live agent state, the tool-call
timeline, the thinking, the files being changed, the tokens and cost as they accrue — and lets you
*act on it* with precise approval, steering, and a fast command palette without breaking the
session's flow. Beyond one session it is a *command center*: it runs and coordinates many Claude
Code sessions across git worktrees, warns when they collide, hands context between them, and lets
you find, name, fork, and resume any session you've run. It *remembers your work* via searchable
history, surfaced memory, and an optional knowledge graph, and lets you *reach your sessions from
anywhere* — browser or phone. It stays *open and hackable* (Apache-2.0, lifecycle hooks, jiti TS
extensions). It is not a replacement for Claude Code and not a neutral layer above it — it is the
terminal *designed for* Claude Code, competing on integration depth.

**Success test:** someone who has used GlaudeCode for a week can't imagine running Claude Code in
a plain terminal again.

**The one filter every feature passes (Constitution Principle II):** *does this make a Claude Code
user's work meaningfully better than the terminal they have now?* If it only re-skins what Claude
Code's own app or opcode already do well, it does not ship.

---

## V1 Scope — "The terminal where you can SEE what Claude Code is doing"

Six features. All on data proven feasible in the spikes. Ordered by dependency. Each is an
independently shippable vertical slice with explicit acceptance criteria and a test requirement.

> Build order is top-to-bottom. Each item = one or more PRs. Definition of done for EVERY item:
> code + tests pass + `pr-review-toolkit` clean + AGENTS.md/docs updated (Principle IX) + the
> acceptance criteria below are demonstrably met.

### V1-0 — Engine package + ClaudeCodeAdapter (foundation, blocks everything)
- **What:** `packages/engine` — host-agnostic TS lib. `ClaudeCodeAdapter` wrapping the Agent SDK
  (`listSessions`, `getSessionMessages`, `getSessionInfo`, `forkSession`, `renameSession`,
  `tagSession`). Runs as a Bun sidecar the Tauri core spawns; exposes a typed RPC to the WebView.
- **Acceptance:** desktop app starts the sidecar; a typed `engine.listSessions()` call from the
  renderer returns the real sessions for the current project. All Claude Code access goes through
  the adapter (Principle XI) — no raw `~/.claude/projects` JSONL parsing anywhere.
- **Tests:** engine unit/integration tests against a real session fixture; adapter contract test.

### V1-1 — Sessions sidebar (entry fee, done terminal-native)
- **What:** a sidebar beside the terminal listing sessions with title, last-active, git branch,
  cwd; click to view; fast fuzzy search/filter; rename + tag + delete.
- **Acceptance:** sidebar shows real sessions within 200ms of open; search filters live; rename/tag
  persist; selecting a session shows its summary. No tight `listSessions()` polling (event/debounce
  only — Principle XI / SDK #268).
- **Tests:** component tests for list/search/rename; engine test for the data path.

### V1-2 — Agent-state status bar (DIFFERENTIATED)
- **What:** a status bar showing the active session's live state — `idle / thinking / running tool
  <name> / waiting for approval` — with an elapsed timer and current model.
- **Acceptance:** state transitions reflect the real session within ~1s; elapsed timer runs;
  model name correct. Driven by the session message stream, not screen-scraping.
- **Tests:** state-machine unit tests over a recorded session stream fixture.

### V1-3 — Tool-call timeline + thinking panel (DIFFERENTIATED)
- **What:** a collapsible panel listing every tool call (name + inputs + result status) and the
  agent's extended-thinking blocks, in order, for the active session.
- **Acceptance:** every `tool_use` and `thinking` block in the session renders in order; long
  entries collapse; updates live as the session progresses.
- **Tests:** render tests over a fixture session containing tool_use + thinking blocks.

### V1-4 — Live token/cost counter
- **What:** running token count (from `message.usage`) and a computed USD estimate (tokens ×
  model price table — interactive sessions do NOT include cost; we compute it) for the active
  session, shown in the chrome.
- **Acceptance:** token count matches the session; cost is a clearly-labeled estimate; updates live.
- **Tests:** cost-calculation unit tests against known token counts + a price table.

### V1-5 — Persistent changes panel
- **What:** a panel listing every file the agent created/modified this session (from
  `file-history-snapshot` data), with quick open.
- **Acceptance:** the file list matches what the session actually touched; clicking opens the file;
  updates live.
- **Tests:** engine test mapping file-history-snapshot → file list over a fixture.

**V1 STATUS: COMPLETE (2026-06-09).** All six features built, tested (engine 56/56), committed on
branch `feat/v1-0-engine-adapter`. Architecture: pure session-computation logic in
`@glaudecode/engine` (tested) exposed via RPC computed server-side; the WebView renders.

---

## V2 Scope — "The terminal you can run many agents in and walk away from"

**V2 is specified in detail across SEVEN research-backed epic design docs in `docs/design/`. This
section is the index + build order; the design doc is the source of truth for each epic.**

> **MANDATORY for the build loop:** before implementing ANY item, READ that epic's design doc in
> full (`docs/design/epic-<x>-*.md`) — it has the architecture, data model, edge cases, security,
> test plan, and acceptance criteria. Do NOT build from this index alone; that produces the thin,
> namesake implementation V2 exists to avoid. Build each item against its design doc.

**Build order: A → B → C → D → E → F → G** (dependency + value; A is foundational multi-PTY, G is the
largest). The differentiated "walk away & trust it" cluster is A + C(approval) + C(gauge) + B(meta-agent).

### Locked decisions (founder-approved 2026-06-09)
1. **Pane↔session binding — RESOLVED:** `claude --session-id <uuid>` is supported; spawn with a
   generated uuid and bind deterministically. (`--name`/`--model`/`--permission-mode`/`--fork-session`
   also available.)
2. **Extensions:** trusted-only for V2 (documented risk); sandboxing is a pre-1.0 gate.
3. **Approvals:** opt-in (toggle), not auto-managed settings.json; dangerous tools fail-closed when
   the engine is unreachable, read-only fail-open.
4. **graphify/Python:** optional (degrade gracefully); global search ships FTS5-first, embeddings later.
5. **Cockpit:** "view + steer" scope (state + approvals + follow-ups); terminal pixel-mirroring
   deferred; desktop + web share a `packages/ui`.

### Epics (each = one or more branch+PR; build its items in order)
- **Epic A — Orchestration** → `docs/design/epic-a-orchestration.md`
  A1 WorktreeManager · A2 ConflictDetector ⭐ · A3 multi-PTY registry (Rust) · A4 orchestration UI
  (tabs/panes, new-session-in-worktree via `claude --session-id`, conflict banner) · A5 context handoff.
- **Epic B — Extensibility** → `docs/design/epic-b-extensibility.md`
  B1 EventBus · B2 jiti ExtensionHost (trusted-only) · B3 meta-agent (advisory, opt-in, budget-aware) ⭐.
- **Epic C — Cost & control** → `docs/design/epic-c-cost-control.md`
  C1 context-window gauge ⭐ · C2 smart approval (policy + PreToolUse-hook→engine callback + pane) ⭐ ·
  C3 budgets + alerts ⭐ · C4 model suggestion (cheap-mode).
- **Epic D — Memory & knowledge** → `docs/design/epic-d-memory-knowledge.md`
  D1 memory + AGENTS.md editor + "loaded context" view ⭐ · D2 graphify graph (optional) ⭐ ·
  D3 global FTS5 search ⭐.
- **Epic E — Session tooling** → `docs/design/epic-e-session-tooling.md`
  E1 GitManager · E2 git-in-changes (status/stage/commit) ⭐ · E3 inline diff editor · E4 session
  compare ⭐ · E5 semantic resume · E6 replay/share ⭐ · E7 bookmarks.
- **Epic F — Terminal UX** → `docs/design/epic-f-terminal-ux.md`
  F1 command palette · F2 keybindings · F3 prompt library + slash-command builder ⭐ ·
  F4 desktop notifications ⭐.
- **Epic G — Cockpit** → `docs/design/epic-g-cockpit.md`
  G1 RemoteServer + WS event stream · G2 pairing + scoped/expiring tokens (security-critical) ·
  G3 `packages/ui` extraction + web/PWA client · G4 mobile view+steer + remote approvals ⭐.

**Differentiation filter (Principle II):** the ⭐ items are the moat. If any item drifts into a
generic re-skin of what Anthropic's app / opcode already do, STOP and flag — do not ship the
commoditized version.

### Current progress (2026-06-09)
Branch `feat/v2-a-orchestration`. **A1 WorktreeManager** ✅ (tested), **A2 ConflictDetector** ✅
(tested + `conflicts` RPC), **A3 multi-PTY registry (Rust)** ✅ (`PtyRegistry` keyed by `paneId`;
pane-scoped `pty_spawn/write/resize/kill`; namespaced `pty-output:{paneId}`/`pty-exit:{paneId}`
events; `cmd`/`args` so a pane hosts the shell or `claude --session-id <uuid>`). Resume at **A4
orchestration UI** (tabs/panes + new-session-in-worktree + conflict banner), then A5 context handoff.

---

## Autonomous-Build Guardrails (an automated agent MUST obey ALL of these)

1. **Branch + PR only.** Never commit directly to `main`. Each work item → a feature branch → a PR.
2. **Tests gate the PR.** No PR is opened unless the build passes and the item's tests pass.
3. **Never destructive.** Never force-push, never rewrite `main` history, never delete user data or
   sessions, never modify the git identity / `.git/config` / remote (Principle: git identity is
   load-bearing — commits MUST stay `prabs0410`).
4. **Respect the adapter rule (Principle XI).** All Claude Code access via `ClaudeCodeAdapter` +
   SDK APIs; no raw JSONL parsing; no tight polling.
5. **One item at a time, in epic order (A→G).** Do not start the next item until the current item's
   work is committed and green. Within an epic, follow the item order (A1, A2, …).
6. **Stop on repeated failure.** After 2 consecutive failed attempts on an item, STOP and leave a
   clear note for human review rather than thrash.
7. **Keep docs honest (Principle IX).** Every PR updates AGENTS.md / `docs/INDEX.md` / `docs/state.md`
   as relevant, in the same PR.
8. **Felt-improvement filter (Principle II).** If an item drifts into generic re-skinning of what
   Anthropic's app / opcode already do, stop and flag — do not ship the commoditized version.
9. **Design-doc-first + TDD.** READ the epic's `docs/design/` doc before building. Pure logic
   (parsers, state derivation, cost, conflict detection, etc.) lives in `@glaudecode/engine` and is
   unit-tested there; UI logic gets component/typecheck coverage. No item is "done" until its
   design-doc acceptance criteria are met and its tests pass.

### The one human knob
- **Auto-merge to `main`:** OFF by default (PRs stay open for human approval). May be turned ON by
  the founder for fuller autonomy — recorded here when set: **[ currently OFF ]**.

---

## How this gets executed (the loop)
V2 is fully specified: this index + the seven `docs/design/` epic docs. The autonomous loop reads
the current epic's design doc, implements the next item against it (design-doc-first + TDD), commits
on a feature branch under the guardrails, and continues in epic order A→G. V1 is complete; resume at
**Epic A, item A1 (WorktreeManager)** on branch `feat/v2-a-orchestration` — the porcelain parser +
git exec wrappers are written; finish its tests, then A2 onward.

PRs are currently blocked on `prabs0410` GitHub auth (commits land on the branch correctly as
prabs0410; opening PRs needs `gh auth login` as prabs0410 — see memory). Until then the loop commits
per-item on the branch; the founder opens PRs/merges when authenticated.

**Honest note (recorded with founder's informed consent, 2026-06-08):** maximum autonomy on a
taste-dependent product carries real risk of building the commoditized version well while missing
the differentiation that is the entire moat. The guardrails above bound the *damage*, not the
*judgment*. Human PR review is the safety valve; skipping it (auto-merge ON) raises that risk.
