import { useEffect, useState } from "react";
import { budgetStatus, setBudget, type BudgetStatus } from "./engine";

// Per-project budget indicator (Epic C §3.3). Shows today's estimated spend against the
// project's daily cap, coloured ok/warn/over. Click to set/change the daily cap. The
// alert path (desktop notification) lands with Epic F; here we surface the status-bar
// indicator. Spend is an estimate (tokens × price table), clearly so.
const POLL_MS = 8000;

interface Props {
  projectDir: string | null;
  liveSessions: Array<{ id: string; dir: string }>;
}

export function BudgetChip({ projectDir, liveSessions }: Props) {
  const [status, setStatus] = useState<BudgetStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const key = liveSessions.map((s) => s.id).sort().join(",");

  useEffect(() => {
    if (!projectDir) {
      setStatus(null);
      return;
    }
    let alive = true;
    const poll = async () => {
      try {
        const s = await budgetStatus(projectDir, liveSessions);
        if (alive) setStatus(s);
      } catch {
        /* transient */
      }
    };
    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectDir, key]);

  if (!projectDir) return null;

  const save = async () => {
    const dailyUsd = Number(draft);
    setEditing(false);
    if (projectDir && Number.isFinite(dailyUsd) && dailyUsd > 0) {
      try {
        await setBudget(projectDir, { dailyUsd, warnPct: 0.8 });
        setStatus(await budgetStatus(projectDir, liveSessions));
      } catch {
        /* ignore */
      }
    }
  };

  if (editing) {
    return (
      <input
        className="budget-input"
        autoFocus
        placeholder="daily $ cap"
        value={draft}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
          if (e.key === "Escape") setEditing(false);
        }}
        onBlur={() => setEditing(false)}
      />
    );
  }

  const cap = status?.budget?.dailyUsd;
  const today = status?.dailyUsd ?? 0;
  const state = status?.state ?? "none";

  return (
    <button
      className={`budget-chip ${state}`}
      title={cap ? "Estimated spend today vs your daily cap — click to change" : "Set a daily spend cap"}
      onClick={() => {
        setDraft(cap ? String(cap) : "");
        setEditing(true);
      }}
    >
      {cap ? `~$${today.toFixed(2)} / $${cap.toFixed(0)}` : "set budget"}
    </button>
  );
}
