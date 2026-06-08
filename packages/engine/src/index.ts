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
export { detectConflicts } from "./conflicts";
export type { ConflictWarning, SessionChanges } from "./conflicts";
export { buildHandoffSummary } from "./handoff";
export type { HandoffOptions } from "./handoff";
export { EventBus } from "./eventBus";
export type {
  EmitResult,
  LifecycleEvent,
  LifecycleEventType,
  LifecycleHandler,
  SessionStartReason,
  Subscription,
} from "./eventBus";
export { ExtensionHost, defaultExtensionDirs } from "./extensionHost";
export type {
  CommandFn,
  ExtensionApi,
  ExtensionHostOptions,
  ExtensionImporter,
  ExtensionModule,
  LoadedExtension,
} from "./extensionHost";
export { MetaAgent, generateObservations } from "./metaAgent";
export type { MetaAgentInput, Observation, ObserveOptions } from "./metaAgent";
export { computeContextUsage, DEFAULT_CONTEXT_LIMITS } from "./contextUsage";
export type { ContextLimitTable, ContextUsage, ContextUsageOptions } from "./contextUsage";
export { classifyTool } from "./approval";
export type { ClassifyOptions, ToolClassification, ToolDecision } from "./approval";
export {
  ApprovalHookInstaller,
  HOOK_SENTINEL,
  buildApprovalHookEntry,
  hasApprovalHook,
  mergeApprovalHook,
  removeApprovalHook,
} from "./approvalHook";
export type { ApprovalHookOptions, ClaudeSettings } from "./approvalHook";
export { ApprovalQueue } from "./approvalQueue";
export type {
  ApprovalRequest,
  ApprovalResult,
  FinalDecision,
  SubmitCall,
  SubmitOptions,
} from "./approvalQueue";
export { CostStore, aggregateDayCosts, evaluateBudget } from "./budget";
export type { Budget, BudgetState, BudgetStatus, DayCost, RollupSummary } from "./budget";
export { suggestModel, latestUserPrompt } from "./modelSuggestion";
export type { ModelSuggestion } from "./modelSuggestion";
export { MemoryStore, parseLoadedContext, encodeProjectDir } from "./memory";
export type { LoadedContext, MemoryFile, ProjectInstructions } from "./memory";
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
