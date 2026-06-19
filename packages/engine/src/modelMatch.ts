// Shared model-id → table-key matcher for the family-keyed price (cost.ts) and context-limit
// (contextUsage.ts) tables. Both used to iterate `Object.keys(table)` and return the FIRST key the
// model id contained — order-dependent, no precedence. Harmless with today's disjoint families
// (opus/sonnet/haiku), but a future id that contains an existing family token (e.g. a key "opus" vs a
// more specific "opus-4") would silently mis-resolve to whichever key happened to come first (#38).
//
// This resolves deterministically: an EXACT (case-insensitive) key wins; otherwise the LONGEST
// matching substring key wins (the most specific family). The `exact` flag lets callers surface that a
// price/limit was matched HEURISTICALLY (a family substring), not a known model id — so an estimate
// built on a fuzzy match can be flagged rather than trusted silently.

export interface ModelKeyMatch {
  /** The winning table key (in its original casing). */
  key: string;
  /** True only when the model id equals the key exactly (case-insensitive); false for a substring hit. */
  exact: boolean;
}

/** Resolve a model id to the best key among `keys`: exact match first, then the longest substring key.
 *  Returns null when nothing matches. Ties on length keep the earliest key (stable). */
export function matchModelKey(model: string, keys: Iterable<string>): ModelKeyMatch | null {
  const m = String(model ?? "").toLowerCase();
  if (!m) return null;
  const list = [...keys];
  for (const k of list) {
    if (m === k.toLowerCase()) return { key: k, exact: true };
  }
  let best: string | null = null;
  for (const k of list) {
    if (k && m.includes(k.toLowerCase()) && (best === null || k.length > best.length)) best = k;
  }
  return best === null ? null : { key: best, exact: false };
}
