import { useEffect, useState } from "react";
import { conflicts, type ConflictWarning } from "./engine";

// Cross-session conflict warning (Epic A §3.6). When ≥2 live Claude panes touch the
// same file, show a non-blocking banner naming the file and the sessions. Conflicts
// are computed server-side (detectConflicts, tested); each session is read from its
// own worktree dir. Polled slower than the 2s status loop to bound getSessionMessages
// load (Open Question 4 — debounce harder).
const POLL_MS = 4000;

interface LiveSession {
  id: string;
  dir: string;
  title: string;
}

export function ConflictBanner({ sessions }: { sessions: LiveSession[] }) {
  const [warnings, setWarnings] = useState<ConflictWarning[]>([]);
  // Re-subscribe only when the *set* of live sessions changes, not every render
  // (the parent rebuilds the array each time).
  const key = sessions
    .map((s) => s.id)
    .sort()
    .join(",");

  useEffect(() => {
    if (sessions.length < 2) {
      setWarnings([]);
      return;
    }
    let alive = true;
    const poll = async () => {
      try {
        const w = await conflicts(sessions.map((s) => ({ id: s.id, dir: s.dir })));
        if (alive) setWarnings(w);
      } catch {
        /* transient (session not on disk yet, etc.) — keep last known */
      }
    };
    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (warnings.length === 0) return null;

  const titleFor = (id: string) => sessions.find((s) => s.id === id)?.title ?? id.slice(0, 8);

  return (
    <div className="conflict-banner" role="alert">
      {warnings.map((w) => (
        <div key={w.path} className="conflict-row">
          <span className="conflict-icon">⚠</span>
          <span className="conflict-path">{basename(w.path)}</span>
          <span className="conflict-detail">
            edited by {w.sessionIds.map(titleFor).join(" & ")}
          </span>
        </div>
      ))}
    </div>
  );
}

function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
