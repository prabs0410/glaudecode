# @glaudecode/engine

Host-agnostic TypeScript engine for GlaudeCode. Zero Tauri/Electron dependency — the desktop app
spawns it as a Bun sidecar; a future hosted tier runs the same library on a server (ADR 0004).

## ClaudeCodeAdapter

The **only** point in GlaudeCode that touches Claude Code (Constitution Principle XI). All access
goes through the supported Agent SDK APIs — never raw `~/.claude/projects` JSONL parsing — so a
change to Claude Code's interface touches exactly one file. Callers receive clean domain types
(`SessionSummary`, `SessionMessage`, …); SDK shapes never leak past the adapter.

```ts
import { ClaudeCodeAdapter } from "@glaudecode/engine";

const adapter = new ClaudeCodeAdapter();
const sessions = await adapter.listSessions({ dir: "/path/to/project" });
const messages = await adapter.getSessionMessages(sessions[0].id, { dir: "/path/to/project" });
```

Methods: `listSessions`, `getSessionInfo`, `getSessionMessages`, `forkSession` (supports
`upToMessageId` for fork-from-point), `renameSession`, `tagSession`.

## Test

```sh
bun test                                   # unit (portable) + integration (skips if no sessions)
GLAUDE_TEST_PROJECT_DIR=/path bun test     # integration against a specific project's sessions
```
