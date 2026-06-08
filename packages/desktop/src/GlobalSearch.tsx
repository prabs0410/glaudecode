import { useEffect, useState } from "react";
import { reindex, search, type SearchHit } from "./engine";

// Global content search (Epic D §3.3). Searches the FTS index across indexed sessions and
// jumps to the chosen one. Reindex pulls the current project's sessions into the index.
// (A Cmd-P command-palette entry point ties in with Epic F.)
const DEBOUNCE_MS = 250;

interface Props {
  dir: string | null;
  onSelect: (sessionId: string) => void;
}

export function GlobalSearch({ dir, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      return;
    }
    let alive = true;
    const id = setTimeout(async () => {
      try {
        const res = await search(q);
        if (alive) setHits(res);
      } catch {
        /* ignore */
      }
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [query]);

  const doReindex = async () => {
    if (!dir) return;
    setBusy(true);
    try {
      await reindex(dir);
      if (query.trim()) setHits(await search(query.trim()));
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gsearch">
      <div className="gsearch-row">
        <input
          className="sidebar-search gsearch-input"
          placeholder="Search all content…"
          value={query}
          spellCheck={false}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
        <button className="act" title="Index this project's sessions" disabled={busy} onClick={() => void doReindex()}>
          {busy ? "…" : "Index"}
        </button>
      </div>

      {query.trim() && (
        <ul className="gsearch-results">
          {hits.length === 0 && <li className="session-empty">No matches (try Index first).</li>}
          {hits.map((h) => (
            <li
              key={h.sessionId}
              className="gsearch-hit"
              onClick={() => {
                onSelect(h.sessionId);
                setQuery("");
              }}
              title={h.sessionId}
            >
              <div className="gsearch-snippet">{highlight(h.snippet)}</div>
              <div className="gsearch-meta">{h.sessionId.slice(0, 8)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// FTS5 wraps matches in ⟦ ⟧; render those as <mark>.
function highlight(snippet: string) {
  const parts = snippet.split(/⟦|⟧/);
  return parts.map((p, i) => (i % 2 === 1 ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>));
}
