import { useCallback, useEffect, useState } from "react";
import {
  gitCommit,
  gitDiff,
  gitRestore,
  gitRevertHunk,
  gitStage,
  sessionChangesGit,
  type FileDiff,
  type GitChangeFile,
} from "./engine";

// Changes panel (V1-5 deepened by Epic E §3.2). Lists the files the agent touched, joined
// with live git status, and lets you stage + commit them and view per-file diffs — without
// leaving the terminal. Git writes are explicit user actions. Per-hunk revert is added in E3.
const POLL_MS = 2500;

export function ChangesPanel({ dir, selectedId }: { dir: string | null; selectedId: string | null }) {
  const [files, setFiles] = useState<GitChangeFile[]>([]);
  const [isRepo, setIsRepo] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [commitMsg, setCommitMsg] = useState("");
  const [openDiff, setOpenDiff] = useState<{ rel: string; diff: FileDiff[] } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!dir || !selectedId) return;
    try {
      const res = await sessionChangesGit(selectedId, dir);
      setFiles(res.files);
      setIsRepo(res.isRepo);
      setError(null);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }, [dir, selectedId]);

  useEffect(() => {
    if (!dir || !selectedId) {
      setFiles([]);
      return;
    }
    void reload();
    const id = setInterval(reload, POLL_MS);
    return () => clearInterval(id);
  }, [dir, selectedId, reload]);

  const toggle = (rel: string) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(rel) ? next.delete(rel) : next.add(rel);
      return next;
    });

  const stage = async () => {
    if (!dir || selected.size === 0) return;
    try {
      await gitStage(dir, [...selected]);
      setStatus(`Staged ${selected.size} file(s)`);
      setSelected(new Set());
      await reload();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  };

  const commit = async () => {
    if (!dir || !commitMsg.trim()) return;
    try {
      const { output } = await gitCommit(dir, commitMsg.trim());
      setStatus(output.split("\n")[0] ?? "Committed");
      setCommitMsg("");
      await reload();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  };

  const showDiff = async (rel: string) => {
    if (!dir) return;
    if (openDiff?.rel === rel) {
      setOpenDiff(null);
      return;
    }
    try {
      setOpenDiff({ rel, diff: await gitDiff(dir, rel) });
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  };

  const revert = async (rel: string) => {
    if (!dir) return;
    if (!confirm(`Discard all changes to ${rel}? This runs git restore.`)) return;
    try {
      await gitRestore(dir, [rel]);
      setStatus(`Reverted ${rel}`);
      setOpenDiff(null);
      await reload();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  };

  const revertHunk = async (rel: string, hunk: { header: string; lines: string[] }) => {
    if (!dir) return;
    try {
      await gitRevertHunk(dir, rel, hunk);
      setStatus("Reverted hunk");
      // Re-diff so the view reflects the new state (refuses + re-diffs on conflict).
      const fresh = await gitDiff(dir, rel);
      setOpenDiff(fresh.some((f) => f.hunks.length) ? { rel, diff: fresh } : null);
      await reload();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  };

  if (!selectedId)
    return <div className="dock-empty">Open or focus a Claude session to see its changes.</div>;
  if (error) return <div className="dock-error">{error}</div>;

  return (
    <div className="changes-panel">
      {status && <div className="changes-status">{status}</div>}
      {!isRepo && <div className="dock-empty">Not a git repo — showing touched files only.</div>}

      <ul className="changes-list">
        {files.map((f) => (
          <li key={f.path} className="change-row">
            <div className="change-line">
              {isRepo && (
                <input
                  type="checkbox"
                  checked={selected.has(f.rel)}
                  onChange={() => toggle(f.rel)}
                  title="Select to stage"
                />
              )}
              {f.gitState && <span className={`git-state ${f.gitState}`}>{f.gitState[0].toUpperCase()}</span>}
              <span className="change-path" title={f.path} onClick={() => void showDiff(f.rel)}>
                {basename(f.path)}
              </span>
              <span className="change-meta">{f.edits}× {f.lastTool}</span>
              {isRepo && (
                <button className="act mini" title="Discard changes" onClick={() => void revert(f.rel)}>
                  ⟲
                </button>
              )}
            </div>
            {openDiff?.rel === f.rel && (
              <DiffView diff={openDiff.diff} onRevertHunk={(h) => void revertHunk(f.rel, h)} />
            )}
          </li>
        ))}
        {files.length === 0 && <li className="dock-empty">No file changes yet</li>}
      </ul>

      {isRepo && files.length > 0 && (
        <div className="changes-actions">
          <button className="act" disabled={selected.size === 0} onClick={() => void stage()}>
            Stage {selected.size || ""}
          </button>
          <input
            className="commit-input"
            placeholder="commit message…"
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && void commit()}
          />
          <button className="act" disabled={!commitMsg.trim()} onClick={() => void commit()}>
            Commit
          </button>
        </div>
      )}
    </div>
  );
}

function DiffView({
  diff,
  onRevertHunk,
}: {
  diff: FileDiff[];
  onRevertHunk: (hunk: { header: string; lines: string[] }) => void;
}) {
  if (diff.length === 0) return <div className="diff-empty">No diff vs HEAD.</div>;
  return (
    <div className="diff-view">
      {diff.flatMap((f) =>
        f.hunks.map((h, i) => (
          <pre key={i} className="diff-hunk">
            <div className="diff-hunk-head">
              <span className="diff-header">{h.header}</span>
              <button className="act mini" title="Revert this hunk" onClick={() => onRevertHunk(h)}>
                ⟲ hunk
              </button>
            </div>
            {h.lines.map((l, j) => (
              <div key={j} className={diffLineClass(l)}>
                {l}
              </div>
            ))}
          </pre>
        )),
      )}
    </div>
  );
}

function diffLineClass(line: string): string {
  if (line.startsWith("+")) return "diff-add";
  if (line.startsWith("-")) return "diff-del";
  return "diff-ctx";
}

function basename(p: string): string {
  const parts = p.split("/");
  return parts[parts.length - 1] || p;
}
