import type { SessionMessage } from "./types";

// Semantic resume (Epic E §3.5). When you reopen a session, a short briefing — a recap of
// where it stands and a suggested next step — so you don't have to re-read the transcript.
// V2 is rule-based (free): it uses the session summary + the most recent turns and the shape
// of the last message. An SDK-`query` digest is a credit-aware opt-in enhancement (same
// pattern as the meta-agent). Pure + unit-tested.

export interface ResumeBriefing {
  recap: string;
  suggestedNext: string;
}

export interface ResumeOptions {
  /** The session's stored summary, if any (preferred for the recap). */
  summary?: string;
  /** Number of changed files (for the suggested next step). */
  changedFiles?: number;
}

export function buildResumeBriefing(messages: SessionMessage[], opts: ResumeOptions = {}): ResumeBriefing {
  const recap = opts.summary?.trim() || recapFromTurns(messages);
  return { recap, suggestedNext: suggestNext(messages, opts.changedFiles ?? 0) };
}

function recapFromTurns(messages: SessionMessage[]): string {
  const lastUser = truncate(lastText(messages, "user"), 200);
  const lastAsst = truncate(lastText(messages, "assistant"), 280);
  if (!lastUser && !lastAsst) return "No activity recorded for this session yet.";
  const parts: string[] = [];
  if (lastUser) parts.push(`You last asked: ${lastUser}`);
  if (lastAsst) parts.push(`The agent last said: ${lastAsst}`);
  return parts.join("\n");
}

function suggestNext(messages: SessionMessage[], changedFiles: number): string {
  const last = messages[messages.length - 1];
  if (!last) return "Send a prompt to start.";

  if (last.role === "user") {
    return "Resume — the agent hadn't replied to your last message yet.";
  }
  if (last.role === "assistant" && hasUnresolvedTool(messages)) {
    return "A tool call was still in progress; resume to let it finish.";
  }
  if (changedFiles > 0) {
    return `Review the ${changedFiles} changed file${changedFiles === 1 ? "" : "s"}, then continue or commit.`;
  }
  return "Pick up where it left off with your next instruction.";
}

/** True if the final assistant turn has a tool_use with no following tool_result. */
function hasUnresolvedTool(messages: SessionMessage[]): boolean {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return false;
  const usedIds = new Set<string>();
  for (const b of last.blocks) if (b.kind === "tool_use" && b.id) usedIds.add(b.id);
  if (usedIds.size === 0) return last.blocks.some((b) => b.kind === "tool_use"); // tool with no id
  // A result would appear in a later message; the last message having tool_use → unresolved.
  return true;
}

function lastText(messages: SessionMessage[], role: SessionMessage["role"]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== role) continue;
    const text = m.blocks
      .filter((b): b is { kind: "text"; text: string } => b.kind === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();
    if (text) return text;
  }
  return "";
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max).trimEnd() + "…";
}
