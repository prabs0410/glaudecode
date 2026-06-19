import type { SessionMessage } from "./types";
import { matchModelKey } from "./modelMatch";

// Context-window gauge (Epic C §3.1). The live context size ≈ the input-side tokens of
// the most recent assistant turn — i.e. what was sent to the model on the last request
// (plain input + cache-read + cache-creation all count toward the window). Fullness =
// that / the model's context limit. Claude Code compacts near the limit, so we warn
// before it. If the model's limit is unknown we return null and the UI hides the gauge
// rather than show a wrong number (§5).

export type ContextLimitTable = Record<string, number>;

// Context limits (tokens) by model-family substring. Best-effort + configurable.
// Opus 4.8 ships a 1M context window (per the design doc); Haiku is 200k.
export const DEFAULT_CONTEXT_LIMITS: ContextLimitTable = {
  opus: 1_000_000,
  sonnet: 1_000_000,
  haiku: 200_000,
};

export interface ContextUsage {
  usedTokens: number;
  limit: number;
  /** usedTokens / limit, clamped to [0, 1]. */
  pct: number;
  /** True once fullness crosses the warn threshold (compaction is near). */
  nearCompaction: boolean;
  /** The model the limit was resolved for. */
  model?: string;
}

export interface ContextUsageOptions {
  /** Override the model (else the latest assistant message's model is used). */
  model?: string;
  limits?: ContextLimitTable;
  /** Fullness at/above which nearCompaction flips. Default 0.85. */
  warnPct?: number;
}

export function computeContextUsage(
  messages: SessionMessage[],
  opts: ContextUsageOptions = {},
): ContextUsage | null {
  const latest = latestAssistantWithUsage(messages);
  if (!latest) return null;

  const u = latest.usage!;
  const usedTokens = (u.inputTokens ?? 0) + (u.cacheReadTokens ?? 0) + (u.cacheCreationTokens ?? 0);

  const model = opts.model ?? latest.model;
  const limit = model ? limitFor(model, opts.limits ?? DEFAULT_CONTEXT_LIMITS) : undefined;
  if (!limit || usedTokens <= 0) return null;

  const warnPct = opts.warnPct ?? 0.85;
  const pct = Math.min(1, usedTokens / limit);
  return { usedTokens, limit, pct, nearCompaction: pct >= warnPct, model };
}

function latestAssistantWithUsage(messages: SessionMessage[]): SessionMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === "assistant" && m.usage) return m;
  }
  return undefined;
}

function limitFor(model: string, table: ContextLimitTable): number | undefined {
  // Longest-key-first (#38), shared with cost.ts: the most specific family key wins deterministically.
  const match = matchModelKey(model, Object.keys(table));
  return match ? table[match.key] : undefined;
}
