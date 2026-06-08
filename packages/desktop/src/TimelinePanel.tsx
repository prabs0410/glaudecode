import { useEffect, useState } from "react";
import { timeline, type TimelineEntry } from "./engine";

// Tool-call timeline + thinking panel (V1-3). Polls the engine's computed
// timeline for the selected session and renders thinking blocks and tool calls
// in order. Long entries collapse. Timeline is built server-side (buildTimeline,
// unit-tested in @glaudecode/engine).

const POLL_MS = 2000;

export function TimelinePanel({ dir, selectedId }: { dir: string | null; selectedId: string | null }) {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dir || !selectedId) {
      setEntries([]);
      return;
    }
    let alive = true;
    const poll = async () => {
      try {
        const t = await timeline(selectedId, dir);
        if (alive) {
          setEntries(t);
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

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  if (!selectedId) {
    return (
      <section className="timeline">
        <div className="timeline-header">Timeline</div>
        <div className="timeline-empty">Select a session to see its activity</div>
      </section>
    );
  }

  return (
    <section className="timeline">
      <div className="timeline-header">Timeline · {entries.length}</div>
      {error && <div className="timeline-error">{error}</div>}
      <ol className="timeline-list">
        {entries.map((e) => {
          const open = expanded.has(e.id);
          if (e.kind === "thinking") {
            return (
              <li key={e.id} className="tl-entry tl-thinking" onClick={() => toggle(e.id)}>
                <span className="tl-icon">✳</span>
                <span className={`tl-thinking-text${open ? " open" : ""}`}>{e.text}</span>
              </li>
            );
          }
          return (
            <li key={e.id} className="tl-entry tl-tool">
              <div className="tl-tool-head" onClick={() => toggle(e.id)}>
                <span className={`tl-status ${e.status}`} />
                <span className="tl-tool-name">{e.name}</span>
              </div>
              {open && (
                <pre className="tl-tool-input">{safeJson(e.input)}</pre>
              )}
            </li>
          );
        })}
        {entries.length === 0 && !error && <li className="timeline-empty">No activity yet</li>}
      </ol>
    </section>
  );
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
