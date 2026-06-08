import type { SessionMessage } from "./types";

// Builds an ordered timeline of the agent's thinking and tool calls from a
// session's messages. Tool calls are paired with their results (by tool_use id)
// to show ok / error / pending status. Pure and tested; exposed via the
// "timeline" RPC so the UI just renders.

export type ToolStatus = "pending" | "ok" | "error";

export type TimelineEntry =
  | { kind: "thinking"; id: string; text: string; timestamp?: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      input: unknown;
      status: ToolStatus;
      timestamp?: string;
    };

export function buildTimeline(messages: SessionMessage[]): TimelineEntry[] {
  // Collect tool results first so a tool_use can resolve its status regardless of
  // where the result message lands.
  const results = new Map<string, boolean>(); // toolUseId -> isError
  for (const m of messages) {
    for (const b of m.blocks) {
      if (b.kind === "tool_result" && b.toolUseId) results.set(b.toolUseId, b.isError);
    }
  }

  const entries: TimelineEntry[] = [];
  for (const m of messages) {
    m.blocks.forEach((b, idx) => {
      if (b.kind === "thinking") {
        entries.push({ kind: "thinking", id: `${m.id}:${idx}`, text: b.text, timestamp: m.timestamp });
      } else if (b.kind === "tool_use") {
        const hasResult = b.id != null && results.has(b.id);
        const status: ToolStatus = hasResult ? (results.get(b.id!) ? "error" : "ok") : "pending";
        entries.push({
          kind: "tool",
          id: b.id ?? `${m.id}:${idx}`,
          name: b.name,
          input: b.input,
          status,
          timestamp: m.timestamp,
        });
      }
    });
  }
  return entries;
}
