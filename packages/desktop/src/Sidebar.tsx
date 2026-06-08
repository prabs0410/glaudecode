import { useEffect, useState } from "react";
import { listSessions, projectDir, type SessionSummary } from "./engine";

// Sessions sidebar. V1-0b proves the renderer -> engine -> Claude Code pipe by
// listing real sessions; V1-1 enriches it (search, rename, tag, delete, select).

export function Sidebar() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const dir = await projectDir();
        setSessions(await listSessions(dir));
      } catch (e: any) {
        setError(String(e?.message ?? e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        Sessions{!loading && !error ? ` · ${sessions.length}` : ""}
      </div>
      {error && <div className="sidebar-error">{error}</div>}
      <ul className="session-list">
        {loading && <li className="session-empty">Loading…</li>}
        {!loading &&
          !error &&
          sessions.map((s) => (
            <li key={s.id} className="session-item" title={s.firstPrompt ?? s.id}>
              <div className="session-title">{s.title || s.firstPrompt || s.id.slice(0, 8)}</div>
              {s.gitBranch && <div className="session-meta">{s.gitBranch}</div>}
            </li>
          ))}
        {!loading && !error && sessions.length === 0 && (
          <li className="session-empty">No sessions for this project</li>
        )}
      </ul>
    </aside>
  );
}
