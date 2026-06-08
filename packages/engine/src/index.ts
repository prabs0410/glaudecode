// @glaudecode/engine — host-agnostic engine library. Zero Tauri/Electron
// dependency: the desktop app spawns it as a sidecar; a future hosted tier runs
// the same library on a server (ADR 0004).

export { ClaudeCodeAdapter } from "./adapter";
export type { ForkOptions, GetMessagesOptions } from "./adapter";
export {
  mapBlocks,
  mapRole,
  mapSessionMessage,
  mapSessionSummary,
  mapUsage,
} from "./mappers";
export type {
  ContentBlock,
  ForkResult,
  MessageRole,
  SessionMessage,
  SessionScope,
  SessionSummary,
  TextBlock,
  ThinkingBlock,
  TokenUsage,
  ToolUseBlock,
} from "./types";
