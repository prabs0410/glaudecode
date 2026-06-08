// Pure mapping functions: Agent SDK shapes -> GlaudeCode domain types.
// Kept separate from the adapter so they can be unit-tested without the SDK or
// a real session on disk. The adapter is the only caller in production.

import type {
  ContentBlock,
  MessageRole,
  SessionMessage,
  SessionSummary,
  TokenUsage,
} from "./types";

export function mapSessionSummary(s: any): SessionSummary {
  return {
    id: String(s?.sessionId ?? ""),
    title: s?.customTitle ?? undefined,
    firstPrompt: s?.firstPrompt ?? undefined,
    summary: s?.summary ?? undefined,
    gitBranch: s?.gitBranch ?? undefined,
    cwd: s?.cwd ?? undefined,
    tag: s?.tag ?? undefined,
    createdAt: s?.createdAt ?? undefined,
    lastModified: s?.lastModified ?? undefined,
    fileSize: typeof s?.fileSize === "number" ? s.fileSize : undefined,
  };
}

export function mapRole(type: unknown): MessageRole {
  if (type === "user" || type === "assistant" || type === "system") return type;
  return "other";
}

export function mapBlocks(message: any): ContentBlock[] {
  const content = message?.content;
  if (typeof content === "string") {
    return content ? [{ kind: "text", text: content }] : [];
  }
  if (!Array.isArray(content)) return [];

  const blocks: ContentBlock[] = [];
  for (const b of content) {
    if (!b || typeof b !== "object") continue;
    if (b.type === "text" && typeof b.text === "string") {
      blocks.push({ kind: "text", text: b.text });
    } else if (b.type === "thinking" && typeof b.thinking === "string") {
      blocks.push({ kind: "thinking", text: b.thinking });
    } else if (b.type === "tool_use") {
      blocks.push({ kind: "tool_use", name: String(b.name ?? ""), input: b.input });
    }
  }
  return blocks;
}

export function mapUsage(message: any): TokenUsage | undefined {
  const u = message?.usage;
  if (!u || typeof u !== "object") return undefined;
  const usage: TokenUsage = {
    inputTokens: numOrUndef(u.input_tokens),
    outputTokens: numOrUndef(u.output_tokens),
    cacheReadTokens: numOrUndef(u.cache_read_input_tokens),
    cacheCreationTokens: numOrUndef(u.cache_creation_input_tokens),
  };
  // Collapse to undefined when nothing useful was present.
  return Object.values(usage).some((v) => v !== undefined) ? usage : undefined;
}

export function mapSessionMessage(m: any): SessionMessage {
  return {
    id: String(m?.uuid ?? ""),
    parentId: m?.parentUuid ?? m?.parent_tool_use_id ?? undefined,
    role: mapRole(m?.type),
    timestamp: m?.timestamp ?? undefined,
    blocks: mapBlocks(m?.message),
    usage: mapUsage(m?.message),
  };
}

function numOrUndef(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}
