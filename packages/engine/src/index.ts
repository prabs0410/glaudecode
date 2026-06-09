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
export { GraphManager, mapGraphJson } from "./graph";
export type { GraphEdge, GraphNode, GraphResult } from "./graph";
export { SearchIndex } from "./searchIndex";
export type { SearchHit } from "./searchIndex";
export { GitManager, parseGitStatus, parseUnifiedDiff, buildHunkPatch } from "./gitManager";
export type { DiffHunk, FileDiff, GitState, GitStatusEntry } from "./gitManager";
export { compareSessions } from "./compare";
export type { SessionComparison, SessionView, SetDiff } from "./compare";
export { buildResumeBriefing } from "./resume";
export type { ResumeBriefing, ResumeOptions } from "./resume";
export { buildReplayBundle, redactText } from "./replay";
export type { ReplayBundle } from "./replay";
export { BookmarkStore } from "./bookmarks";
export type { Bookmark } from "./bookmarks";
export { fuzzyScore, fuzzyRank } from "./fuzzy";
export type { FuzzyResult } from "./fuzzy";
export {
  DEFAULT_KEYBINDINGS,
  KeybindingStore,
  chordFromEvent,
  detectConflicts as detectKeyConflicts,
  matchEvent,
  mergeKeymap,
  normalizeKeys,
  validateKeys,
} from "./keybindings";
export type { Keybinding, KeyEventLike } from "./keybindings";
export { PromptStore, SlashCommandWriter, extractVariables, fillTemplate } from "./prompt";
export type { PromptInfo } from "./prompt";
export { coalesceNotifications } from "./notify";
export type { AppNotification, NotificationKind } from "./notify";
export { PairingService } from "./pairing";
export type { PairCode, PairedDevice, PairingDeps, RemoteToken, TokenScope } from "./pairing";
export { methodScope } from "./rpc";
export { frameEvent, parseFrame } from "./remote";
export type { RemoteFrame } from "./remote";
export { COCKPIT_HTML, MANIFEST_JSON } from "./cockpit";
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
