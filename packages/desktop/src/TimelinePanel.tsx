import { useEffect, useState } from "react";
import {
  addBookmark,
  listBookmarks,
  removeBookmark,
  timeline,
  type TimelineEntry,
} from "./engine";

// Tool-call timeline + thinking panel (V1-3) with bookmarks (Epic E §3.7). Star any entry
// to pin it; bookmarks persist outside Claude Code's session file and prune on delete.
const POLL_MS = 2000;

export function TimelinePanel({ dir, selectedId }: { dir: string | null; selectedId: string | null }) {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dir || !selectedId) {
      setEntries([]);
      setPinned(new Set());
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
    listBookmarks(selectedId)
      .then((bms) => alive && setPinned(new Set(bms.map((b) => b.messageId))))
      .catch(() => {});
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

  const togglePin = async (entryId: string) => {
    if (!selectedId) return;
    const isPinned = pinned.has(entryId);
    // optimistic
    setPinned((prev) => {
      const next = new Set(prev);
      isPinned ? next.delete(entryId) : next.add(entryId);
      return next;
    });
    try {
      if (isPinned) await removeBookmark(selectedId, entryId);
      else await addBookmark(selectedId, entryId);
    } catch {
      /* revert on failure */
      setPinned((prev) => {
        const next = new Set(prev);
        isPinned ? next.add(entryId) : next.delete(entryId);
        return next;
      });
    }
  };

  if (!selectedId)
    return <div className="dock-empty">Open or focus a Claude session to see its activity.</div>;
  if (error) return <div className="dock-error">{error}</div>;

  const shown = pinnedOnly ? entries.filter((e) => pinned.has(e.id)) : entries;

  return (
    <div className="timeline-wrap">
      {pinned.size > 0 && (
        <label className="tl-filter">
          <input type="checkbox" checked={pinnedOnly} onChange={(e) => setPinnedOnly(e.currentTarget.checked)} />
          pinned only ({pinned.size})
        </label>
      )}
      <ol className="timeline-list">
        {shown.map((e) => {
          const open = expanded.has(e.id);
          const star = (
            <button
              className={`tl-star${pinned.has(e.id) ? " on" : ""}`}
              title={pinned.has(e.id) ? "Unpin" : "Pin this moment"}
              onClick={(ev) => {
                ev.stopPropagation();
                void togglePin(e.id);
              }}
            >
              {pinned.has(e.id) ? "★" : "☆"}
            </button>
          );
          if (e.kind === "thinking") {
            return (
              <li key={e.id} className="tl-entry tl-thinking">
                {star}
                <span className="tl-icon" onClick={() => toggle(e.id)}>
                  ✳
                </span>
                <span className={`tl-thinking-text${open ? " open" : ""}`} onClick={() => toggle(e.id)}>
                  {e.text}
                </span>
              </li>
            );
          }
          return (
            <li key={e.id} className="tl-entry tl-tool">
              <div className="tl-tool-head">
                {star}
                <span className={`tl-status ${e.status}`} onClick={() => toggle(e.id)} />
                <span className="tl-tool-name" onClick={() => toggle(e.id)}>
                  {e.name}
                </span>
              </div>
              {open && <pre className="tl-tool-input">{safeJson(e.input)}</pre>}
            </li>
          );
        })}
        {shown.length === 0 && <li className="dock-empty">{pinnedOnly ? "No pinned moments" : "No activity yet"}</li>}
      </ol>
    </div>
  );
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
