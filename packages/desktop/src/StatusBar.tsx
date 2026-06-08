import { useEffect, useState } from "react";
import { BudgetChip } from "./BudgetChip";
import {
  agentState,
  contextUsage,
  sessionCost,
  type AgentState,
  type ContextUsage,
  type SessionCost,
} from "./engine";

// Agent-state status bar (V1-2). Polls the engine's computed agentState for the
// selected session every 2s and shows status + tool + elapsed + model. The state
// is derived server-side (deriveAgentState, unit-tested in @glaudecode/engine).

const POLL_MS = 2000;

interface StatusBarProps {
  dir: string | null;
  selectedId: string | null;
  /** Project root + live sessions for the project-level budget chip. */
  projectDir: string | null;
  liveSessions: Array<{ id: string; dir: string }>;
}

export function StatusBar({ dir, selectedId, projectDir, liveSessions }: StatusBarProps) {
  const [state, setState] = useState<AgentState | null>(null);
  const [cost, setCost] = useState<SessionCost | null>(null);
  const [ctx, setCtx] = useState<ContextUsage | null>(null);
  const [, setTick] = useState(0); // 1s re-render so the elapsed timer advances

  useEffect(() => {
    if (!dir || !selectedId) {
      setState(null);
      setCost(null);
      setCtx(null);
      return;
    }
    let alive = true;
    const poll = async () => {
      try {
        const [s, c, x] = await Promise.all([
          agentState(selectedId, dir),
          sessionCost(selectedId, dir),
          contextUsage(selectedId, dir),
        ]);
        if (alive) {
          setState(s);
          setCost(c);
          setCtx(x);
        }
      } catch {
        /* transient; keep last known values */
      }
    };
    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [dir, selectedId]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!selectedId) {
    return (
      <div className="statusbar">
        <span className="status-muted">No session selected</span>
        <span className="status-spacer" />
        <BudgetChip projectDir={projectDir} liveSessions={liveSessions} />
      </div>
    );
  }

  const status = state?.status ?? "idle";
  const elapsed = state?.sinceMs ? formatElapsed(Date.now() - state.sinceMs) : "";

  return (
    <div className="statusbar">
      <span className={`status-dot ${status}`} />
      <span className="status-label">{state ? labelFor(state) : "…"}</span>
      {elapsed && <span className="status-elapsed">{elapsed}</span>}
      <span className="status-spacer" />
      {ctx && (
        <span
          className={`status-context${ctx.nearCompaction ? " warn" : ""}`}
          title={`Context window: ${formatTokens(ctx.usedTokens)} / ${formatTokens(ctx.limit)}${
            ctx.nearCompaction ? " — compaction near" : ""
          }`}
        >
          ctx {Math.round(ctx.pct * 100)}%
        </span>
      )}
      {cost && (
        <span className="status-cost" title="Estimated — tokens × model price table">
          {formatTokens(cost.totalTokens)} tok · ~${cost.usd.toFixed(cost.usd < 1 ? 4 : 2)} est
        </span>
      )}
      {state?.model && <span className="status-model">{state.model}</span>}
      <BudgetChip projectDir={projectDir} liveSessions={liveSessions} />
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function labelFor(s: AgentState): string {
  switch (s.status) {
    case "running-tool":
      return `Running ${s.toolName ?? "tool"}`;
    case "thinking":
      return "Thinking";
    default:
      return "Idle";
  }
}

function formatElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
