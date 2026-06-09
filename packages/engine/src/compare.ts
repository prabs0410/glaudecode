// Session comparison (Epic E §3.4). Given two sessions' computed views (tools used, files
// touched, cost/tokens), produce a structural diff: which tools/files each used uniquely vs
// in common, and the cost/token delta. The "which approach was better" view — pairs with
// fork (V1) and orchestration (Epic A). Pure + unit-tested; the RPC builds the views.

export interface SessionView {
  sessionId: string;
  tools: string[];
  files: string[];
  usd: number;
  tokens: number;
}

export interface SetDiff {
  onlyA: string[];
  onlyB: string[];
  both: string[];
}

export interface SessionComparison {
  a: string;
  b: string;
  tools: SetDiff;
  files: SetDiff;
  /** b − a (positive = B cost more). */
  costDeltaUsd: number;
  tokenDelta: number;
}

export function compareSessions(a: SessionView, b: SessionView): SessionComparison {
  return {
    a: a.sessionId,
    b: b.sessionId,
    tools: splitSets(a.tools, b.tools),
    files: splitSets(a.files, b.files),
    costDeltaUsd: b.usd - a.usd,
    tokenDelta: b.tokens - a.tokens,
  };
}

function splitSets(a: string[], b: string[]): SetDiff {
  const sa = new Set(a);
  const sb = new Set(b);
  return {
    onlyA: [...sa].filter((x) => !sb.has(x)).sort(),
    onlyB: [...sb].filter((x) => !sa.has(x)).sort(),
    both: [...sa].filter((x) => sb.has(x)).sort(),
  };
}
