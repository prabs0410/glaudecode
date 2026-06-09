// Fuzzy matching for the command palette (Epic F §3.1). Pure + unit-tested; mirrored in
// the desktop bundle (like filterSessions) so the WebView doesn't import the Node-only
// engine. Subsequence match with a score that rewards contiguous runs, word-boundary and
// start-of-string hits — good enough for a palette without a heavy dependency.

export interface FuzzyResult<T> {
  item: T;
  score: number;
}

/** Score how well `query` fuzzy-matches `text`. 0 = no match; higher = better. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (q.length === 0) return 1;
  if (q.length > t.length) return 0;

  let score = 0;
  let ti = 0;
  let run = 0;
  let prevMatchIndex = -1;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    const found = t.indexOf(ch, ti);
    if (found === -1) return 0; // not a subsequence → no match
    // Base point for the match.
    score += 1;
    // Contiguous-run bonus.
    if (found === prevMatchIndex + 1) {
      run += 1;
      score += run * 2;
    } else {
      run = 0;
    }
    // Word-boundary / start bonus.
    if (found === 0 || /[\s/_\-.:]/.test(t[found - 1] ?? "")) score += 3;
    prevMatchIndex = found;
    ti = found + 1;
  }
  // Prefer shorter targets (tighter match).
  score += Math.max(0, 5 - (t.length - q.length) / 4);
  return score;
}

/** Rank items by fuzzy score against a key, dropping non-matches. Stable for ties. */
export function fuzzyRank<T>(query: string, items: T[], key: (item: T) => string): FuzzyResult<T>[] {
  const scored = items.map((item, i) => ({ item, score: fuzzyScore(query, key(item)), i }));
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ item, score }) => ({ item, score }));
}
