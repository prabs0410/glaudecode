// Domain types for GlaudeCode. These are the ONLY session shapes the rest of the
// app sees. Raw Agent SDK types never leak past the ClaudeCodeAdapter (Constitution
// Principle XI — all Claude Code integration is isolated behind the adapter).

export interface SessionSummary {
  id: string;
  /** Human or AI-generated title (SDK `customTitle`), if any. */
  title?: string;
  firstPrompt?: string;
  summary?: string;
  gitBranch?: string;
  cwd?: string;
  tag?: string;
  createdAt?: string;
  lastModified?: string;
  fileSize?: number;
}

export type MessageRole = "user" | "assistant" | "system" | "other";

export interface TextBlock {
  kind: "text";
  text: string;
}
export interface ThinkingBlock {
  kind: "thinking";
  text: string;
}
export interface ToolUseBlock {
  kind: "tool_use";
  id?: string;
  name: string;
  input: unknown;
}
export interface ToolResultBlock {
  kind: "tool_result";
  toolUseId?: string;
  isError: boolean;
}
export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock;

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

export interface SessionMessage {
  id: string;
  parentId?: string;
  role: MessageRole;
  timestamp?: string;
  /** Model that produced an assistant message (e.g. "claude-opus-4-8"), if present. */
  model?: string;
  blocks: ContentBlock[];
  usage?: TokenUsage;
}

export interface SessionScope {
  /** Project directory whose sessions to operate on (SDK `dir` semantics). */
  dir: string;
}

export interface ForkResult {
  sessionId: string;
}
