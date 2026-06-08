import { useEffect, useState } from "react";
import { sessionChanges, type ChangeEntry } from "./engine";

// Persistent changes panel (V1-5). Lists files the agent created/modified this
// session (derived from file-writing tool calls, computed server-side by
// buildChanges). Click a file to copy its path.
const POLL_MS = 2000;

export function ChangesPanel({ dir, selectedId }: { dir: string | null; selectedId: string | null }) {
  const [changes, setChanges] = useState<ChangeEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!dir || !selectedId) {
      setChanges([]);
      return;
    }
    let alive = true;
    const poll = async () => {
      try {
        const c = await sessionChanges(selectedId, dir);
        if (alive) {
          setChanges(c);
          setError(null);
        }
      } catch (e: any) {
        if (alive) setError(String(e?.message ?? e));
      }
    };
    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [dir, selectedId]);

  const copy = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(path);
      setTimeout(() => setCopied((c) => (c === path ? null : c)), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };

  if (!selectedId) return <div className="dock-empty">Select a session to see its changes</div>;
  if (error) return <div className="dock-error">{error}</div>;

  return (
    <ul className="changes-list">
      {changes.map((c) => (
        <li key={c.path} className="change-item" onClick={() => void copy(c.path)} title={c.path}>
          <span className="change-path">{basename(c.path)}</span>
          <span className="change-meta">
            {copied === c.path ? "copied" : `${c.edits}× ${c.lastTool}`}
          </span>
        </li>
      ))}
      {changes.length === 0 && <li className="dock-empty">No file changes yet</li>}
    </ul>
  );
}

function basename(p: string): string {
  const parts = p.split("/");
  return parts[parts.length - 1] || p;
}
