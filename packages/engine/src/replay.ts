import type { ContentBlock, SessionMessage } from "./types";

// Replay / share (Epic E §3.6). Export a session as a portable, schema-versioned JSON
// bundle that a viewer can re-open. Transcripts can contain secrets, so export runs a
// best-effort redaction pass (and the UI shows a clear warning that it is NOT a guarantee).
// Nothing is uploaded by GlaudeCode — the user shares the file. Pure + unit-tested.

export interface ReplayBundle {
  version: 1;
  sessionId: string;
  entries: SessionMessage[];
  meta: Record<string, unknown>;
  redacted: boolean;
}

// Best-effort secret patterns. Conservative to avoid over-redacting real content.
const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, // PEM private keys
  /\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g, // sk-/pk- API keys (OpenAI/Anthropic/Stripe-ish)
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, // GitHub tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, // Slack tokens
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWTs
  /\b[Bb]earer\s+[A-Za-z0-9._-]{16,}/g, // bearer tokens
];

const REDACTED = "[REDACTED]";

/** Replace obvious secrets with a placeholder. Best-effort, not a guarantee. */
export function redactText(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, REDACTED);
  return out;
}

/** Build a portable replay bundle, optionally redacting message text + tool inputs. */
export function buildReplayBundle(
  sessionId: string,
  messages: SessionMessage[],
  meta: Record<string, unknown> = {},
  opts: { redact?: boolean } = {},
): ReplayBundle {
  const redact = opts.redact ?? true;
  const entries = redact ? messages.map(redactMessage) : messages;
  return { version: 1, sessionId, entries, meta, redacted: redact };
}

function redactMessage(m: SessionMessage): SessionMessage {
  return { ...m, blocks: m.blocks.map(redactBlock) };
}

function redactBlock(b: ContentBlock): ContentBlock {
  if (b.kind === "text" || b.kind === "thinking") return { ...b, text: redactText(b.text) };
  if (b.kind === "tool_use") return { ...b, input: deepRedact(b.input) };
  return b;
}

function deepRedact(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(deepRedact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = deepRedact(v);
    return out;
  }
  return value;
}
