# Spike — Claude Code Integration Foundation

**Date**: 2026-06-01
**Researcher**: GlaudeCode session
**Question**: Do the three Principle XI / ADR 0004 architecture-critical risks actually hold? Run real code, not analysis.
**Environment**: bun 1.2.18, node v24.12.0, claude 2.1.158 (Claude Code), `@anthropic-ai/claude-agent-sdk@0.3.158`, macOS
**Spike location**: `~/Hub/glaudecode-experiments/spike-sdk/` (throwaway, outside repo)
**Test subject**: the session `32abbd4b-…` created by interactive `claude` (this build session itself)

## Results — all three core questions VERIFIED

### A. Can a standalone Bun process read an INTERACTIVELY-created session via the SDK? ✅
- `listSessions({ dir })` returned the interactive session with rich metadata:
  `sessionId, summary, lastModified, fileSize, customTitle, firstPrompt, gitBranch, cwd, tag, createdAt`
  — i.e. the entire sessions-sidebar dataset, for free.
- `getSessionInfo(id, { dir })` returned the same metadata for a single session.
- `getSessionMessages(id, { dir })` returned all messages (854 → 861 across runs as the live
  session kept streaming), structured, with type counts (`user`/`assistant`) and per-message keys
  (`type, uuid, session_id, message, parent_tool_use_id, timestamp`).
- **Bonus finding**: reading an *actively-being-written* session worked fine — no partial-entry
  breakage observed in the SDK's returned messages (the SDK handles the streaming-fragment edge
  cases that raw JSONL parsing would expose).

### B. Can we fork an interactively-created session? ✅
- `forkSession(id, { dir })` (the non-model export) returned a new `sessionId`, the fork was
  readable with all messages copied, and the **original was untouched** (same message count
  before and after). Non-destructive, as documented.

### C. Does `bun build --compile` break the SDK (issue #150)? ✅ for the read/fork path
- `bun build read-test.ts --compile` produced a single binary that **ran clean** — no
  `$bunfs/cli.js not found` error. `listSessions`/`getSessionInfo`/`getSessionMessages` all work
  in the compiled binary.
- **Nuance**: issue #150 is specifically about resolving the Claude Code CLI binary, which only
  occurs on the `query()` / model-invocation path. Read + fork do not invoke the CLI, so they
  compile clean. The model-invocation path (meta-agent, feature #8) would still need the #150
  workaround (`pathToClaudeCodeExecutable` / extract binary).

## What this de-risks
The core of ADR 0004 / Principle XI is sound: the SDK is a usable, supported integration surface
for the read-heavy features (sessions sidebar, message timeline, changes panel, fork, continue),
and it survives single-binary compilation. The "fragile undocumented JSONL" fear does not apply
to the read path — the SDK read APIs work and return clean structured data.

## NOT yet tested (honest scope of this spike)
- **Terminal rendering** — Tauri + xterm.js + portable-pty running real `claude` in a PTY. Lower
  risk (Terax ships exactly this), but unproven in our hands.
- **`query()` under `--compile`** — the #150 workaround path was not exercised live; only noted.
- **`listSessions()` memory leak (#268)** under sustained polling — not stress-tested; the design
  rule (no tight polling; event/debounce) stands as mitigation.
- **Cross-session contamination (#26964)** — not reproduced; design rule (one session per worktree
  dir) stands as mitigation.

## SDK session surface discovered (for build reference)
Exports: `listSessions, getSessionInfo, getSessionMessages, getSubagentMessages, getSubagentMessages,
forkSession, renameSession, tagSession, deleteSession, foldSessionSummary, importSessionToStore,
InMemorySessionStore, query`. Signatures: `listSessions({dir,limit,offset})`,
`getSessionInfo(id,{dir})`, `getSessionMessages(id,{dir})`, `forkSession(id,{dir})`.

## Cleanup
Test fork session deleted via `deleteSession` (manually approved). Only the real `32abbd4b`
session remains in the store.
