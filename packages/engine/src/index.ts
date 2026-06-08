// @glaudecode/engine — host-agnostic engine library. Zero Tauri/Electron
// dependency: the desktop app spawns it as a sidecar; a future hosted tier runs
// the same library on a server (ADR 0004).

export { ClaudeCodeAdapter } from "./adapter";
export type { ForkOptions, GetMessagesOptions } from "./adapter";
export { createRpcHandler, dispatch } from "./rpc";
export type { RpcMethod } from "./rpc";
export { startEngineServer } from "./server";
export type { EngineServer, StartOptions } from "./server";
export {
  mapBlocks,
  mapRole,
  mapSessionMessage,
  mapSessionSummary,
  mapUsage,
} from "./mappers";
export { filterSessions } from "./filter";
export { deriveAgentState } from "./agentState";
export type { AgentState, AgentStatus } from "./agentState";
export { buildTimeline } from "./timeline";
export type { TimelineEntry, ToolStatus } from "./timeline";
export { computeSessionCost, DEFAULT_PRICES } from "./cost";
export type { ModelPrice, PriceTable, SessionCost } from "./cost";
export { buildChanges } from "./changes";
export type { ChangeEntry } from "./changes";
export { WorktreeManager, parseWorktreePorcelain } from "./worktree";
export type { WorktreeInfo } from "./worktree";
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
