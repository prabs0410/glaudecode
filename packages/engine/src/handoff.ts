import type { SessionMessage } from "./types";

// Context handoff (Epic A §3.5). There is no live inter-session messaging in Claude
// Code — the only mechanism is to seed a target session with text. This module builds
// a concise, injectable digest of where a *source* session left off; the UI pastes it
// into the target pane (bracketed paste) for the user to review and send. Pure and
// unit-tested; the RPC just feeds it the source session's messages.

export interface HandoffOptions {
  /** Source session's display title, woven into the digest header if given. */
  fromTitle?: string;
  /** Hard cap on the digest body (default 1500 chars) to keep the paste sane. */
  maxChars?: number;
}

/** Build the handoff prompt a user hands from one session into another. */
export function buildHandoffSummary(messages: SessionMessage[], opts: HandoffOptions = {}): string {
  const maxChars = opts.maxChars ?? 1500;
  const digest = truncate(lastAssistantText(messages), maxChars);
  const header = opts.fromTitle
    ? `Context handed off from session "${opts.fromTitle}".`
    : "Context handed off from another session.";
  const body = digest || "(that session has no assistant output yet)";
  return `${header}\n\nWhere it left off:\n${body}\n\nPlease continue this work from here.`;
}

/** Concatenated text blocks of the most recent assistant message, trimmed. */
function lastAssistantText(messages: SessionMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const text = m.blocks
      .filter((b): b is { kind: "text"; text: string } => b.kind === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return "";
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max).trimEnd()}…`;
}
