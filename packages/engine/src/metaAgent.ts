import type { AgentState } from "./agentState";
import type { ChangeEntry } from "./changes";
import { detectConflicts } from "./conflicts";

// Meta-agent (Epic B §3.3). An ADVISORY observer across live sessions. It reads the
// V1 computed views (agentState + changes) and surfaces rule-based observations:
// "may be stuck", "two sessions edit the same file" (reusing Epic A's ConflictDetector),
// "finished — changes ready". It NEVER acts on its own — it can suggest a handoff, which
// the user confirms. V2 is rule-based only; SDK `query` digests are deferred (they draw
// the separate SDK credit pool — must be budget-gated, Epic C), so cost is $0 here.
//
// generateObservations is pure (now is injected) → deterministic and unit-tested. The
// MetaAgent wrapper carries the off-by-default switch and the (currently $0) cost.

export interface MetaAgentInput {
  sessionId: string;
  title?: string;
  state: AgentState;
  changes: ChangeEntry[];
}

export interface Observation {
  /** Deterministic, content-derived → dedupes across polls. */
  id: string;
  level: "info" | "warn";
  text: string;
  sessionIds: string[];
  at: string;
}

export interface ObserveOptions {
  /** Injected wall-clock (ms) for determinism. */
  now: number;
  /** A session thinking/running a tool longer than this reads as "may be stuck". */
  stuckMs?: number;
}

const DEFAULT_STUCK_MS = 5 * 60_000;

export function generateObservations(inputs: MetaAgentInput[], opts: ObserveOptions): Observation[] {
  const stuckMs = opts.stuckMs ?? DEFAULT_STUCK_MS;
  const at = new Date(opts.now).toISOString();
  const label = (id: string) => inputs.find((i) => i.sessionId === id)?.title ?? id.slice(0, 8);
  const out: Observation[] = [];

  // 1) Possibly stuck: in a working state past the threshold.
  for (const i of inputs) {
    const { status, sinceMs, toolName } = i.state;
    if ((status === "running-tool" || status === "thinking") && sinceMs !== undefined) {
      const elapsed = opts.now - sinceMs;
      if (elapsed >= stuckMs) {
        const what = status === "running-tool" ? `running ${toolName ?? "a tool"}` : "thinking";
        out.push({
          id: `stuck:${i.sessionId}`,
          level: "warn",
          text: `${label(i.sessionId)} has been ${what} for ${minutes(elapsed)} — may be stuck`,
          sessionIds: [i.sessionId],
          at,
        });
      }
    }
  }

  // 2) Cross-session file conflicts (reuse Epic A).
  for (const c of detectConflicts(inputs.map((i) => ({ sessionId: i.sessionId, changes: i.changes })))) {
    out.push({
      id: `conflict:${c.path}`,
      level: "warn",
      text: `${c.sessionIds.map(label).join(" & ")} are editing the same file (${basename(c.path)})`,
      sessionIds: c.sessionIds,
      at,
    });
  }

  // 3) Finished: idle after doing work (changes ready to review/hand off).
  for (const i of inputs) {
    if (i.state.status === "idle" && i.changes.length > 0) {
      const n = i.changes.length;
      out.push({
        id: `finished:${i.sessionId}`,
        level: "info",
        text: `${label(i.sessionId)} is idle after changing ${n} file${n === 1 ? "" : "s"}`,
        sessionIds: [i.sessionId],
        at,
      });
    }
  }

  return out;
}

// Advisory controller: off by default, never acts, reports its (rule-based) cost.
export class MetaAgent {
  private enabled = false;

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  /** Rule-based observation has no model cost. SDK-query digests (deferred) would. */
  estimatedCostUsd(): number {
    return 0;
  }

  /** Returns [] while disabled (off by default); otherwise the rule-based observations. */
  observe(inputs: MetaAgentInput[], opts: ObserveOptions): Observation[] {
    if (!this.enabled) return [];
    return generateObservations(inputs, opts);
  }
}

function minutes(ms: number): string {
  return `${Math.max(1, Math.round(ms / 60_000))}m`;
}

function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
