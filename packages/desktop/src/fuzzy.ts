// Frontend mirror of @glaudecode/engine's fuzzy matcher. Behaviour is verified by that
// package's tests (test/fuzzy.test.ts); kept in sync deliberately rather than importing the
// engine (which pulls the Node-only Agent SDK) into the WebView bundle.

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
    if (found === -1) return 0;
    score += 1;
    if (found === prevMatchIndex + 1) {
      run += 1;
      score += run * 2;
    } else {
      run = 0;
    }
    if (found === 0 || /[\s/_\-.:]/.test(t[found - 1] ?? "")) score += 3;
    prevMatchIndex = found;
    ti = found + 1;
  }
  score += Math.max(0, 5 - (t.length - q.length) / 4);
  return score;
}

export function fuzzyRank<T>(query: string, items: T[], key: (item: T) => string): T[] {
  return items
    .map((item, i) => ({ item, score: fuzzyScore(query, key(item)), i }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((s) => s.item);
}
