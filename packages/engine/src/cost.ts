import type { SessionMessage } from "./types";
import { matchModelKey } from "./modelMatch";

// Token + cost accounting for a session. Interactive Claude Code sessions record
// token usage but NOT a dollar cost, so we compute an ESTIMATE: tokens x a
// per-model price table. The table is configurable; the defaults are best-effort
// per-million-token USD figures matched by model family (opus/sonnet/haiku).

export interface ModelPrice {
  inputPerM: number;
  outputPerM: number;
  cacheReadPerM?: number;
  cacheWritePerM?: number;
}

export type PriceTable = Record<string, ModelPrice>;

// Best-effort defaults (USD per 1M tokens), keyed by model-family substring.
// Configurable; treat the resulting cost as an estimate, not a bill.
export const DEFAULT_PRICES: PriceTable = {
  opus: { inputPerM: 15, outputPerM: 75, cacheReadPerM: 1.5, cacheWritePerM: 18.75 },
  sonnet: { inputPerM: 3, outputPerM: 15, cacheReadPerM: 0.3, cacheWritePerM: 3.75 },
  haiku: { inputPerM: 1, outputPerM: 5, cacheReadPerM: 0.1, cacheWritePerM: 1.25 },
};

export interface SessionCost {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  /** Estimated USD; 0 if no model prices matched. Always an estimate. */
  usd: number;
  /** Tokens whose message had no matching price (cost not counted for these). */
  unpricedTokens: number;
}

export function computeSessionCost(
  messages: SessionMessage[],
  prices: PriceTable = DEFAULT_PRICES,
): SessionCost {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let usd = 0;
  let unpricedTokens = 0;

  for (const m of messages) {
    const u = m.usage;
    if (!u) continue;
    const i = u.inputTokens ?? 0;
    const o = u.outputTokens ?? 0;
    const cr = u.cacheReadTokens ?? 0;
    const cw = u.cacheCreationTokens ?? 0;

    inputTokens += i;
    outputTokens += o;
    cacheReadTokens += cr;
    cacheCreationTokens += cw;

    const price = m.model ? priceFor(m.model, prices) : undefined;
    if (!price) {
      unpricedTokens += i + o + cr + cw;
      continue;
    }
    usd += (i / 1e6) * price.inputPerM;
    usd += (o / 1e6) * price.outputPerM;
    usd += (cr / 1e6) * (price.cacheReadPerM ?? 0);
    usd += (cw / 1e6) * (price.cacheWritePerM ?? 0);
  }

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens,
    usd,
    unpricedTokens,
  };
}

function priceFor(model: string, table: PriceTable): ModelPrice | undefined {
  // Longest-key-first (#38) via the shared matcher — a more specific family key wins over a shorter
  // token it contains, instead of whichever Object.keys order happened to surface first.
  const match = matchModelKey(model, Object.keys(table));
  return match ? table[match.key] : undefined;
}
