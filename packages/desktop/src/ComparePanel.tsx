import { useEffect, useState } from "react";
import {
  compareSessions,
  listSessions,
  type SessionComparison,
  type SessionSummary,
  type SetDiff,
} from "./engine";

// Session compare (Epic E §3.4). Pick the inspected session as A and another as B; show a
// side-by-side structural diff — tools and files each used uniquely vs in common, and the
// cost/token delta. The "which approach was better" view.

export function ComparePanel({
  dir,
  selectedId,
  projectDir,
}: {
  dir: string | null;
  selectedId: string | null;
  projectDir: string | null;
}) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [bId, setBId] = useState<string>("");
  const [cmp, setCmp] = useState<SessionComparison | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Candidate B sessions are scoped to the PROJECT root, not session A's cwd: when A lives in a
  // git worktree, A's cwd is the worktree path (a different SDK project scope), so listing against
  // it would offer the wrong sessions. Fall back to A's dir only when the project root is unknown.
  const listDir = projectDir ?? dir;
  useEffect(() => {
    if (!listDir) return;
    listSessions(listDir).then(setSessions).catch(() => setSessions([]));
  }, [listDir]);

  useEffect(() => {
    if (!dir || !selectedId || !bId || bId === selectedId) {
      setCmp(null);
      return;
    }
    // Read each session from ITS OWN cwd — B may live in a different directory than A, and the
    // SDK resolves the session's project from the dir it's read with.
    const bDir = sessions.find((s) => s.id === bId)?.cwd ?? listDir ?? dir;
    compareSessions({ id: selectedId, dir }, { id: bId, dir: bDir })
      .then((c) => {
        setCmp(c);
        setError(null);
      })
      .catch((e) => setError(String(e?.message ?? e)));
  }, [dir, selectedId, bId, sessions, listDir]);

  if (!selectedId)
    return (
      <div className="dock-empty">Open or focus a Claude session to compare it (A) with another.</div>
    );

  return (
    <div className="compare-panel">
      <div className="compare-pick">
        <span className="compare-a" title={selectedId}>
          A: {selectedId.slice(0, 8)}
        </span>
        <span>vs</span>
        <select className="compare-select" value={bId} onChange={(e) => setBId(e.currentTarget.value)}>
          <option value="">Pick B…</option>
          {sessions
            .filter((s) => s.id !== selectedId)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {(s.title || s.firstPrompt || s.id.slice(0, 8)).slice(0, 40)}
              </option>
            ))}
        </select>
      </div>

      {error && <div className="dock-error">{error}</div>}

      {cmp && (
        <div className="compare-body">
          <div className="compare-legend">
            <span className="pos">green</span> = B lower (cheaper / fewer) ·{" "}
            <span className="neg">red</span> = B higher
          </div>
          <div className="compare-metric">
            <span>Cost Δ (B−A)</span>
            <span className={cmp.costDeltaUsd > 0 ? "neg" : "pos"}>
              {cmp.costDeltaUsd >= 0 ? "+" : ""}${cmp.costDeltaUsd.toFixed(4)}
            </span>
          </div>
          <div className="compare-metric">
            <span>Tokens Δ (B−A)</span>
            <span className={cmp.tokenDelta > 0 ? "neg" : "pos"}>
              {cmp.tokenDelta >= 0 ? "+" : ""}
              {cmp.tokenDelta.toLocaleString()}
            </span>
          </div>
          <SetDiffView title="Tools" diff={cmp.tools} />
          <SetDiffView title="Files" diff={cmp.files} basename />
        </div>
      )}
    </div>
  );
}

function SetDiffView({ title, diff, basename: base }: { title: string; diff: SetDiff; basename?: boolean }) {
  const fmt = (s: string) => (base ? s.split("/").pop() || s : s);
  return (
    <div className="compare-set">
      <div className="compare-set-title">{title}</div>
      <div className="compare-cols">
        <Col label="only A" items={diff.onlyA.map(fmt)} cls="only-a" />
        <Col label="both" items={diff.both.map(fmt)} cls="both" />
        <Col label="only B" items={diff.onlyB.map(fmt)} cls="only-b" />
      </div>
    </div>
  );
}

function Col({ label, items, cls }: { label: string; items: string[]; cls: string }) {
  return (
    <div className={`compare-col ${cls}`}>
      <div className="compare-col-label">{label}</div>
      {items.length === 0 ? (
        <div className="compare-none">—</div>
      ) : (
        items.map((x, i) => (
          <div key={i} className="compare-item" title={x}>
            {x}
          </div>
        ))
      )}
    </div>
  );
}
