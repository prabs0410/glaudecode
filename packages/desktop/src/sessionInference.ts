// Frontend mirror of @glaudecode/engine's shell-pane session inference. Behaviour is verified by that
// package's tests (test/sessionInference.test.ts); kept in sync deliberately rather than importing the
// engine (which pulls the Node-only Agent SDK) into the WebView bundle.
//
// When the active pane is a plain *shell* in which the user ran `claude` by hand, GlaudeCode can't know
// that session's id directly, so it infers it from the cwd's sessions. The naive "newest wins, sticky"
// heuristic could silently lock onto the WRONG session when two are live in one repo (audit #11). This
// adds a single-live / margin tiebreaker and an explicit `ambiguous` signal so a real two-live tie is
// SURFACED, never guessed.

/** A session in the active cwd: its id + last-modified time (epoch millis; 0 = unknown/never). */
export interface SessionCandidate {
  id: string;
  ts: number;
}

export interface InferOptions {
  /** Current wall-clock (epoch millis). Injected so the fn stays pure + testable. */
  now: number;
  /** The session id currently sticky-locked for this cwd (null = none yet). Thread `result.locked` back. */
  locked?: string | null;
  /** A session counts as "live" only if touched within this window. Default 120_000 (2 min). */
  liveWindowMs?: number;
  /** The newest live session must lead the runner-up by at least this margin to switch/pick
   *  confidently; closer than this with 2+ live and we refuse to guess (ambiguous). Default 10_000. */
  marginMs?: number;
}

export interface InferResult {
  /** The session to dock to — may equal `locked` (sticky), the new winner, or null (none/ambiguous-unlocked). */
  sessionId: string | null;
  /** The sticky lock to thread back into the next tick's `locked`. */
  locked: string | null;
  /** True when 2+ live candidates sit within `marginMs` of each other — we couldn't pick one
   *  confidently, so the dock surfaces "ambiguous" instead of silently binding (audit #11). */
  ambiguous: boolean;
}

/** Infer which session the active shell pane is driving. Confident only when there's effectively one
 *  live session (or a clear newest); a two-live near-tie is reported `ambiguous` and never silently
 *  switched. An existing live lock is kept (sticky) so the dock stays usable while flagged. */
export function inferShellSession(candidates: SessionCandidate[], opts: InferOptions): InferResult {
  const now = opts.now;
  const locked = opts.locked ?? null;
  const liveWindowMs = opts.liveWindowMs ?? 120_000;
  const marginMs = opts.marginMs ?? 10_000;

  const valid = candidates.filter((c) => c && typeof c.id === "string");
  // Newest-first. Array.sort is stable, so exact ts ties keep the caller's listing order.
  const live = valid.filter((c) => now - c.ts < liveWindowMs).sort((a, b) => b.ts - a.ts);
  const lockedPresent = locked != null && valid.some((c) => c.id === locked);
  const keepLock = (ambiguous: boolean): InferResult => ({
    sessionId: lockedPresent ? locked : null,
    locked: lockedPresent ? locked : null,
    ambiguous,
  });

  // Nothing live: stay sticky on the lock if it still exists (idle-but-ours), else nothing.
  if (live.length === 0) return keepLock(false);

  const winner = live[0];
  const runnerUp = live[1];
  const ambiguous = runnerUp != null && winner.ts - runnerUp.ts < marginMs;

  if (ambiguous) {
    // 2+ sessions too close to call. Never silently switch. Keep an existing live lock (sticky);
    // otherwise refuse to guess and surface the tie for a manual pick.
    const lockedIsLive = locked != null && live.some((c) => c.id === locked);
    if (lockedIsLive) return { sessionId: locked, locked, ambiguous: true };
    return keepLock(true);
  }

  // Clear winner: a single live session, or the newest leads the runner-up by ≥ marginMs. Lock onto it
  // (if we already hold it this is a no-op; if a different session decisively took over, we switch).
  return { sessionId: winner.id, locked: winner.id, ambiguous: false };
}
