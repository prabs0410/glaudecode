// Pure edge-detector for server-side push triggers (V8 Phase 1.2). The engine has no notification
// event bus, so the server samples each live session's derived state on its EXISTING ~2s broadcast
// tick and fires a push only on a TRANSITION (not on a steady state) — so a session that stays idle or
// stays waiting doesn't buzz every tick. Approval pushes come from a separate enqueue hook; this covers
// question / finished / error. Pure + table-tested; the server supplies the snapshots + the dedupe.

import type { NotificationKind } from "./notify";

/** A session's push-relevant state at one sample, derived from the typed message stream:
 *  `waiting` = promptState.isWaiting (AskUserQuestion / ExitPlanMode), `idle` = agentState.status is
 *  "idle" (turn finished), `errorCount` = number of error tool_results seen so far. */
export interface PhaseSnapshot {
  waiting: boolean;
  idle: boolean;
  errorCount: number;
}

/** Which push kinds a session→ transition warrants. Edges only (so steady states don't repeat):
 *  - question: not-waiting → waiting
 *  - finished: was-running (not idle) → idle
 *  - error:    a NEW error tool_result appeared since the last sample
 *  `prev === undefined` (first time we see a session) emits NOTHING — we need an edge, and we must not
 *  buzz for state that predates the phone subscribing. */
export function detectPushKinds(prev: PhaseSnapshot | undefined, cur: PhaseSnapshot): NotificationKind[] {
  if (!prev) return [];
  const kinds: NotificationKind[] = [];
  if (cur.waiting && !prev.waiting) kinds.push("question");
  if (cur.idle && !prev.idle) kinds.push("finished");
  if (cur.errorCount > prev.errorCount) kinds.push("error");
  return kinds;
}
