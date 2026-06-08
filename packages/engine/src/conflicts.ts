import type { ChangeEntry } from "./changes";

// Cross-session conflict detection (Epic A). A conflict = the same file path appears
// in the change sets of two or more sessions running concurrently. Pure and tested;
// the orchestration layer supplies each active session's changes (via buildChanges).

export interface SessionChanges {
  sessionId: string;
  changes: ChangeEntry[];
}

export interface ConflictWarning {
  path: string;
  sessionIds: string[];
}

export function detectConflicts(perSession: SessionChanges[]): ConflictWarning[] {
  const byPath = new Map<string, Set<string>>();
  for (const { sessionId, changes } of perSession) {
    for (const c of changes) {
      let set = byPath.get(c.path);
      if (!set) byPath.set(c.path, (set = new Set()));
      set.add(sessionId);
    }
  }
  const out: ConflictWarning[] = [];
  for (const [path, sessions] of byPath) {
    if (sessions.size >= 2) out.push({ path, sessionIds: [...sessions] });
  }
  // Stable, deterministic ordering.
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
