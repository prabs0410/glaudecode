import type { SessionMessage } from "./types";

// Derives an at-a-glance agent state from a session's persisted message stream.
//
// Honest scope: Claude Code writes its JSONL as it streams, so recent activity +
// the shape of the last message give a good approximation of what the agent is
// doing right now. We can reliably tell idle / thinking / running-a-tool. A
// distinct "waiting for approval" is NOT distinguishable from "running a tool" in
// the persisted data alone (both look like an assistant tool_use with no result
// yet), so it is folded into "running-tool" until we tap the live stream.

export type AgentStatus = "idle" | "thinking" | "running-tool";

export interface AgentState {
  status: AgentStatus;
  /** Tool being run, when status is "running-tool". */
  toolName?: string;
  /** Model of the most recent assistant message, if known. */
  model?: string;
  /** Timestamp (ms) the current activity was last observed, for an elapsed timer. */
  sinceMs?: number;
}

const DEFAULT_RECENT_WINDOW_MS = 30_000;

export function deriveAgentState(
  messages: SessionMessage[],
  nowMs: number,
  recentWindowMs: number = DEFAULT_RECENT_WINDOW_MS,
): AgentState {
  const model = latestAssistantModel(messages);
  if (messages.length === 0) return { status: "idle", model };

  const last = messages[messages.length - 1]!;
  const lastTs = last.timestamp ? Date.parse(last.timestamp) : NaN;
  const sinceMs = Number.isNaN(lastTs) ? undefined : lastTs;

  // No recent activity → idle regardless of the last message's shape.
  if (!Number.isNaN(lastTs) && nowMs - lastTs > recentWindowMs) {
    return { status: "idle", model, sinceMs };
  }

  if (last.role === "assistant") {
    const tool = lastToolUse(last);
    if (tool) return { status: "running-tool", toolName: tool, model, sinceMs };
    // Assistant produced a (text) turn with no pending tool → finished.
    return { status: "idle", model, sinceMs };
  }

  if (last.role === "user") {
    // User prompt with no assistant reply yet → the agent is working.
    return { status: "thinking", model, sinceMs };
  }

  return { status: "idle", model, sinceMs };
}

function lastToolUse(message: SessionMessage): string | undefined {
  for (let i = message.blocks.length - 1; i >= 0; i--) {
    const b = message.blocks[i]!;
    if (b.kind === "tool_use") return b.name;
  }
  return undefined;
}

function latestAssistantModel(messages: SessionMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === "assistant" && m.model) return m.model;
  }
  return undefined;
}
