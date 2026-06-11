import { useCallback, useEffect, useMemo, useState } from "react";
import { GlobalSearch } from "./GlobalSearch";
import {
  deleteSession,
  filterSessions,
  listSessions,
  renameSession,
  tagSession,
  type SessionSummary,
} from "./engine";

interface Props {
  dir: string | null;
  selectedId: string | null;
  /** Open a session (switch to its pane if live, else resume it). */
  onSelect: (id: string, cwd?: string, title?: string) => void;
  /** Sessions with a live pane running right now — shown with a "live" dot. */
  liveSessionIds?: Set<string>;
  /** Pixel width (overrides the CSS default) when the panel is resizable. */
  width?: number;
}

// Sessions sidebar (V1-1): lists the project's real sessions with live search,
// selection, inline rename + tag, and delete-with-confirm. All mutations go
// through the engine RPC and reload the list.

export function Sidebar({ dir, selectedId, onSelect, liveSessionIds, width }: Props) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<"rename" | "tag">("rename");
  const [draft, setDraft] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!dir) return;
    try {
      setSessions(await listSessions(dir));
      setError(null);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [dir]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Filter, then order: live sessions first, then most-recently-active. listSessions returns
  // the SDK's raw order; without this the ~99-session list has no useful top (V4-B2).
  const visible = useMemo(() => {
    const ts = (s: SessionSummary) => s.lastModified ?? "";
    return filterSessions(sessions, query).slice().sort((a, b) => {
      const aLive = liveSessionIds?.has(a.id) ? 1 : 0;
      const bLive = liveSessionIds?.has(b.id) ? 1 : 0;
      if (aLive !== bLive) return bLive - aLive; // live first
      return ts(b).localeCompare(ts(a)); // newest first (ISO strings sort chronologically)
    });
  }, [sessions, query, liveSessionIds]);

  const submitRename = async (id: string) => {
    const title = draft.trim();
    setEditingId(null);
    if (dir && title) {
      try {
        await renameSession(id, title, dir);
        await reload();
      } catch (e: any) {
        setError(String(e?.message ?? e));
      }
    }
  };

  const doTag = async (id: string) => {
    if (!dir) return;
    const tag = draft.trim();
    setEditingId(null);
    try {
      await tagSession(id, tag || null, dir);
      await reload();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  };

  const doDelete = async (id: string) => {
    setConfirmingId(null);
    if (!dir) return;
    try {
      await deleteSession(id, dir);
      await reload();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  };

  return (
    <aside className="sidebar" style={width ? { width, minWidth: width } : undefined}>
      <div className="sidebar-header">
        Sessions{!loading && !error ? ` · ${visible.length}` : ""}
      </div>

      <GlobalSearch dir={dir} onSelect={onSelect} />

      <input
        className="sidebar-search"
        placeholder="Filter these sessions…"
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        spellCheck={false}
      />

      {error && <div className="sidebar-error">{error}</div>}

      <ul className="session-list">
        {loading && <li className="session-empty">Loading…</li>}

        {!loading &&
          !error &&
          visible.map((s) => {
            const isSelected = s.id === selectedId;
            const isEditing = s.id === editingId;
            const isConfirming = s.id === confirmingId;
            return (
              <li
                key={s.id}
                className={`session-item${isSelected ? " selected" : ""}`}
                onClick={() => onSelect(s.id, s.cwd, s.title || s.firstPrompt)}
              >
                {isEditing ? (
                  <input
                    className="session-edit"
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.currentTarget.value)}
                    onClick={(e) => e.stopPropagation()}
                    placeholder={editMode === "tag" ? "tag…" : "title…"}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        void (editMode === "tag" ? doTag(s.id) : submitRename(s.id));
                      }
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    onBlur={() => setEditingId(null)}
                  />
                ) : (
                  <div className="session-title">
                    {liveSessionIds?.has(s.id) && <span className="session-live" title="Running now" />}
                    {s.title || s.firstPrompt || s.id.slice(0, 8)}
                  </div>
                )}

                <div className="session-meta">
                  {s.gitBranch && <span className="session-branch">{s.gitBranch}</span>}
                  {s.tag && <span className="session-tag">{s.tag}</span>}
                </div>

                <div className="session-actions" onClick={(e) => e.stopPropagation()}>
                  {isConfirming ? (
                    <>
                      <button className="act danger" onClick={() => void doDelete(s.id)}>
                        Delete
                      </button>
                      <button className="act" onClick={() => setConfirmingId(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="act"
                        title="Rename"
                        onClick={() => {
                          setEditMode("rename");
                          setDraft(s.title ?? "");
                          setEditingId(s.id);
                        }}
                      >
                        Rename
                      </button>
                      <button
                        className="act"
                        title="Tag"
                        onClick={() => {
                          setEditMode("tag");
                          setDraft(s.tag ?? "");
                          setEditingId(s.id);
                        }}
                      >
                        Tag
                      </button>
                      <button className="act" title="Delete" onClick={() => setConfirmingId(s.id)}>
                        ✕
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}

        {!loading && !error && visible.length === 0 && (
          <li className="session-empty">
            {sessions.length === 0 ? "No sessions for this project" : "No matches"}
          </li>
        )}
      </ul>
    </aside>
  );
}
