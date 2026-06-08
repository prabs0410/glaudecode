import { useEffect, useState } from "react";
import { agentState, type AgentState } from "./engine";

// Agent-state status bar (V1-2). Polls the engine's computed agentState for the
// selected session every 2s and shows status + tool + elapsed + model. The state
// is derived server-side (deriveAgentState, unit-tested in @glaudecode/engine).

const POLL_MS = 2000;

export function StatusBar({ dir, selectedId }: { dir: string | null; selectedId: string | null }) {
  const [state, setState] = useState<AgentState | null>(null);
  const [, setTick] = useState(0); // 1s re-render so the elapsed timer advances

  useEffect(() => {
    if (!dir || !selectedId) {
      setState(null);
      return;
    }
    let alive = true;
    const poll = async () => {
      try {
        const s = await agentState(selectedId, dir);
        if (alive) setState(s);
      } catch {
        /* transient; keep last known state */
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
      {state?.model && <span className="status-model">{state.model}</span>}
    </div>
  );
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
