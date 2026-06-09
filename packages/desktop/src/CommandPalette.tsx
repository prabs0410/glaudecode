import { useEffect, useMemo, useRef, useState } from "react";
import { fuzzyRank } from "./fuzzy";
import { search, type SearchHit } from "./engine";

// Command palette (Epic F §3.1). Cmd-K opens a fuzzy finder over registered app actions;
// content-search results (Epic D) appear inline so you can jump to a session. Extensions
// (Epic B) can contribute commands by adding to the registry App passes in.

export interface Command {
  id: string;
  title: string;
  hint?: string;
  run: () => void | Promise<void>;
  keywords?: string;
}

interface Props {
  open: boolean;
  commands: Command[];
  dir: string | null;
  onClose: () => void;
  onSelectSession: (sessionId: string) => void;
}

export function CommandPalette({ open, commands, dir, onClose, onSelectSession }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setHits([]);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Inline content search for longer queries.
  useEffect(() => {
    const q = query.trim();
    if (!open || !dir || q.length < 2) {
      setHits([]);
      return;
    }
    let alive = true;
    const id = setTimeout(async () => {
      try {
        const res = await search(q, 6);
        if (alive) setHits(res);
      } catch {
        /* ignore */
      }
    }, 200);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [query, open, dir]);

  const filteredCommands = useMemo(
    () => (query.trim() ? fuzzyRank(query, commands, (c) => `${c.title} ${c.keywords ?? ""}`) : commands),
    [query, commands],
  );

  // One flat selectable list: commands then session hits.
  const rows = useMemo(
    () => [
      ...filteredCommands.map((c) => ({ kind: "command" as const, c })),
      ...hits.map((h) => ({ kind: "hit" as const, h })),
    ],
    [filteredCommands, hits],
  );

  useEffect(() => {
    if (active >= rows.length) setActive(Math.max(0, rows.length - 1));
  }, [rows.length, active]);

  if (!open) return null;

  const runRow = (i: number) => {
    const row = rows[i];
    if (!row) return;
    if (row.kind === "command") void row.c.run();
    else onSelectSession(row.h.sessionId);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return onClose();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(rows.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runRow(active);
    }
  };

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Run a command or search sessions…"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
        />
        <ul className="palette-list">
          {rows.length === 0 && <li className="palette-empty">No matches</li>}
          {filteredCommands.length > 0 && <li className="palette-group">Commands</li>}
          {rows.map((row, i) =>
            row.kind === "command" ? (
              <li
                key={`c-${row.c.id}`}
                className={`palette-row${i === active ? " active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => runRow(i)}
              >
                <span className="palette-title">{row.c.title}</span>
                {row.c.hint && <span className="palette-hint">{row.c.hint}</span>}
              </li>
            ) : (
              <li key={`h-${row.h.sessionId}-${i}`}>
                {i === filteredCommands.length && <div className="palette-group">Sessions</div>}
                <div
                  className={`palette-row${i === active ? " active" : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => runRow(i)}
                >
                  <span className="palette-snippet">{row.h.snippet.replace(/⟦|⟧/g, "")}</span>
                  <span className="palette-hint">{row.h.sessionId.slice(0, 8)}</span>
                </div>
              </li>
            ),
          )}
        </ul>
      </div>
    </div>
  );
}
