# Epic C — Cost & Control

**Status:** Draft for review
**Depends on:** V1 (cost counter, agentState, changes); Epic F (desktop notifications for alerts)
**Features:** context-window gauge, smart approval pane + policy, budgets + alerts, cheap-mode/model routing

## 1. Problem & user value
The "walk away and trust it" cluster. To run agents unattended you need to: see context filling up
before it compacts, approve/deny risky tool calls from the app (not by watching the TUI), cap spend
per project/day, and avoid burning Opus on trivial tasks. Together these make GlaudeCode the terminal
you can leave running.

**Felt-improvement test:** approval-from-the-app + budgets + context-gauge are genuinely
differentiated — incumbents surface none of them well.

## 2. Research / constraints
- **Context size ≈ the latest assistant message's `input_tokens`** — input tokens are what was sent =
  the current context. So fullness ≈ `latestInputTokens / modelContextLimit`. (Opus 4.8 = 1M context.)
  Compaction fires near the limit; we warn before it.
- **Approval is done right via Claude Code hooks** ([Hooks reference](https://code.claude.com/docs/en/hooks)):
  `PreToolUse` / `PermissionRequest` hooks run before a tool and can return
  `permissionDecision: "allow" | "deny" | "ask"`. A hook is a script; **it can POST to our engine's
  localhost RPC**, which surfaces an in-app approval and returns the decision. This avoids PTY
  scraping entirely and is the supported mechanism.
- **`.claude/settings.json` permissions** (allow/deny/ask lists) are the static layer; hooks are the
  dynamic layer. GlaudeCode manages both for the project.
- **Cheap-mode is constrained for interactive sessions** — the user/session sets the model; we can
  *suggest* or set the session default, but we can't transparently reroute a single interactive
  prompt. Honest scope: suggest + one-click switch, not silent per-prompt routing.

## 3. Architecture
### 3.1 Context-window gauge (engine compute + UI)
Engine RPC `contextUsage(sessionId, dir)` → `{ usedTokens, limit, pct }` from the latest assistant
`input_tokens` and a model→context-limit table. UI: a small gauge in the status bar (next to cost),
amber near the compaction threshold.

### 3.2 Smart approval (the clean design)
1. **Policy** (engine, tested pure fn): `classifyTool(name, input) → "auto-allow" | "ask" | "auto-deny"`.
   Defaults: read-only (Read/Glob/Grep/LS) → auto-allow; dangerous (Bash with `rm`/`push`/`curl`,
   Write outside repo) → ask; everything else → ask.
2. **Hook installer** (engine): writes a `PreToolUse`/`PermissionRequest` hook into the project's
   `.claude/settings.json` (merge, never clobber) whose script POSTs the pending tool call to the
   engine `/approval` endpoint and returns the engine's decision JSON.
3. **Approval pane** (UI): when the engine receives an "ask" callback, it surfaces a non-blocking
   approval card (tool + input + which session); the user's choice returns to the waiting hook. The
   terminal stream is never interrupted.
- **Settings hygiene:** all edits to `.claude/settings.json` are merge-and-restore-able; we record
  what we added so it can be cleanly removed.

### 3.3 Budgets + alerts (engine + persistence)
- Engine persists per-project, per-day cost rollups (`~/.glaudecode/cost/<project>.jsonl`).
- `budgets` config: per-project daily/total caps with warn thresholds (e.g. 80%).
- On crossing a threshold → emit an event → desktop notification (Epic F) + a status-bar indicator.
- Meta-agent (Epic B) respects the same caps.

### 3.4 Cheap-mode / model routing (suggestion-first)
- A pure heuristic `suggestModel(prompt/turn)` flags likely-trivial work → suggest Haiku.
- One-click "switch this session to Haiku" (sets the session default model). No silent per-prompt
  reroute for interactive sessions (documented limit).

## 4. Data model
```ts
interface ContextUsage { usedTokens: number; limit: number; pct: number; nearCompaction: boolean }
type ToolDecision = "auto-allow" | "ask" | "auto-deny";
interface ApprovalRequest { id: string; sessionId: string; tool: string; input: unknown; classified: ToolDecision }
interface Budget { projectDir: string; dailyUsd?: number; totalUsd?: number; warnPct: number }
interface DayCost { date: string; usd: number; tokens: number }
```

## 5. Edge cases & failure modes
- **Hook script can't reach the engine** (engine down) → fail *closed* for dangerous tools (deny/ask),
  fail *open* only for read-only — configurable; default safe.
- **settings.json already has user hooks** → merge, don't overwrite; restore on uninstall.
- **Cost rollup corruption** → append-only JSONL with tolerant parse; a bad line is skipped.
- **Context-limit unknown for a model** → hide the gauge rather than show a wrong number.
- **Approval card ignored** → times out to the policy default (safe), records "auto-decided".

## 6. Security
- Approval defaults are **safe-by-default** (dangerous → ask). The whole point is reducing blast radius.
- `.claude/settings.json` edits are scoped, recorded, reversible.
- Cost data is local only.

## 7. Test plan
- **Unit (pure):** `classifyTool` across a matrix of tools/inputs; `contextUsage` math; budget
  threshold crossing; rollup aggregation; `suggestModel` heuristic.
- **Integration:** install the hook into a temp `.claude/settings.json`, simulate a PreToolUse POST,
  assert the engine returns the decision; cost persistence round-trip.
- **Manual:** approval card UX (no stream interruption), gauge rendering, budget notification.

## 8. Acceptance criteria
- Context-window gauge reflects the selected session's usage and warns before compaction.
- A dangerous tool call triggers an in-app approval card; the decision is honored; the terminal
  stream is not broken. Read-only tools auto-allow.
- A per-project daily budget cap warns at threshold (notification + indicator) and the meta-agent
  respects it.
- Trivial work surfaces a Haiku suggestion with one-click switch.

## 9. Open questions (for review)
1. **Fail-open vs fail-closed when the engine is unreachable** during approval. Recommend: dangerous →
   fail-closed (ask/deny), read-only → fail-open. Confirm.
2. **Do we manage `.claude/settings.json` automatically** (auto-install the approval hook on first
   run) or require explicit user opt-in? Recommend: opt-in, with a clear "enable smart approval" toggle.
3. **Model→context-limit + price tables** need a maintained source; ship best-effort + configurable.
