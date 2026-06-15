import type { SessionMessage } from "./types";

// Derives the live "what is Claude asking right now?" state from a session's persisted message
// stream, so the phone cockpit (Mode C) can render an AskUserQuestion as tappable buttons instead
// of making the user arrow through a TUI. Mirrors agentState.ts's honest-scope approach.
//
// Honest scope (same JSONL limits as agentState): we CAN reliably tell that an `AskUserQuestion`
// or `ExitPlanMode` tool_use is outstanding (no matching tool_result yet) and read its options.
// We CANNOT reliably read the live permission mode from the persisted stream — it's a runtime
// setting, not a message — so `permissionMode` is left undefined and the phone omits the pill
// rather than guess (the Phase-4 founder-decision default).

export interface PromptOption {
  label: string;
  description?: string;
}
export interface PromptQuestion {
  question: string;
  options: PromptOption[];
  multiSelect: boolean;
}
export interface PromptState {
  /** Live permission mode if it were observable — currently always undefined (see file header). */
  permissionMode?: "plan" | "acceptEdits" | "normal" | "bypassPermissions";
  /** The outstanding AskUserQuestion (first question), or null. */
  askUserQuestion: PromptQuestion | null;
  /** True when the agent is blocked on a user choice (AskUserQuestion or ExitPlanMode). */
  isWaiting: boolean;
}

const WAITING_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode"]);

export function derivePromptState(messages: SessionMessage[], _nowMs: number): PromptState {
  // Every tool_use id that already has a result is "answered". (A pending question can sit for a
  // long time, so — unlike agentState — we do NOT gate this by recency: a waiting prompt is waiting.)
  const resolved = new Set<string>();
  for (const m of messages) {
    for (const b of m.blocks) {
      if (b.kind === "tool_result" && b.toolUseId) resolved.add(b.toolUseId);
    }
  }

  // Find the most recent outstanding waiting-tool use.
  for (let i = messages.length - 1; i >= 0; i--) {
    const blocks = messages[i]!.blocks;
    for (let j = blocks.length - 1; j >= 0; j--) {
      const b = blocks[j]!;
      if (b.kind !== "tool_use" || !WAITING_TOOLS.has(b.name)) continue;
      if (b.id && resolved.has(b.id)) continue; // already answered
      if (b.name === "AskUserQuestion") {
        return { askUserQuestion: parseAskUserQuestion(b.input), isWaiting: true };
      }
      return { askUserQuestion: null, isWaiting: true }; // ExitPlanMode — waiting, no option list
    }
  }
  return { askUserQuestion: null, isWaiting: false };
}

/** Parse the first question of an AskUserQuestion tool input (defensive — input is unknown). */
function parseAskUserQuestion(input: unknown): PromptQuestion | null {
  if (!input || typeof input !== "object") return null;
  const qs = (input as { questions?: unknown }).questions;
  if (!Array.isArray(qs) || qs.length === 0) return null;
  const q = qs[0] as Record<string, unknown> | undefined;
  if (!q || typeof q !== "object") return null;
  const options = Array.isArray(q.options)
    ? (q.options as Array<Record<string, unknown>>)
        .map((o) => ({ label: String(o?.label ?? ""), description: o?.description ? String(o.description) : undefined }))
        .filter((o) => o.label)
    : [];
  return { question: String(q.question ?? ""), options, multiSelect: !!q.multiSelect };
}
