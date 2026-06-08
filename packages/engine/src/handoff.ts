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
  const title = opts.fromTitle ? stripControl(opts.fromTitle).trim() : "";
  const header = title
    ? `Context handed off from session "${title}".`
    : "Context handed off from another session.";
  const body = digest || "(that session has no assistant output yet)";
  // SECURITY: the digest/title come from session content (an assistant could have
  // echoed an attacker-controlled file). The UI pastes this into a PTY via bracketed
  // paste, so any smuggled terminal escape — especially the end-paste sequence
  // \x1b[201~ — would break out of the paste and be run as terminal input. Strip all
  // C0/C1 control bytes (keeping tab/newline) so the engine never emits one.
  return stripControl(`${header}\n\nWhere it left off:\n${body}\n\nPlease continue this work from here.`);
}

/** Remove C0/C1 control characters except tab (\t) and newline (\n). */
function stripControl(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
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
