import { useState } from "react";
import { buildGraph, type GraphResult } from "./engine";

// Knowledge-graph panel (Epic D §3.2). On demand, runs graphify on the project and lists
// its nodes/edges. graphify (Python) is optional: when it's absent we show an enable-guide
// instead of failing. A force-directed visualisation is a tracked enhancement; V2 lists the
// graph (grouped by kind) which is enough to explore structure.

export function GraphPanel({ dir }: { dir: string | null }) {
  const [result, setResult] = useState<GraphResult | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!dir) return;
    setLoading(true);
    try {
      setResult(await buildGraph(dir));
    } catch (e: any) {
      setResult({ available: false, reason: String(e?.message ?? e), nodes: [], edges: [], truncated: false });
    } finally {
      setLoading(false);
    }
  };

  if (!dir)
    return <div className="dock-empty">Open or focus a Claude session to map its history.</div>;

  return (
    <div className="graph-panel">
      <div className="graph-head">
        <button className="act" disabled={loading} onClick={() => void run()}>
          {loading ? "Building…" : result ? "Rebuild graph" : "Build graph"}
        </button>
        {result?.available && (
          <span className="graph-stats">
            {result.nodes.length} nodes · {result.edges.length} edges
            {result.truncated ? " (capped)" : ""}
          </span>
        )}
      </div>

      {result && !result.available && <div className="graph-guide">{result.reason}</div>}

      {result?.available && (
        <div className="graph-body">
          <ul className="graph-list">
            {result.nodes.map((n) => (
              <li key={n.id} className="graph-node" title={n.id}>
                <span className={`graph-kind k-${n.kind}`}>{n.kind}</span>
                <span className="graph-label">{n.label}</span>
              </li>
            ))}
          </ul>
          {result.nodes.length === 0 && <div className="dock-empty">Graph is empty.</div>}
        </div>
      )}

      {!result && !loading && (
        <div className="dock-empty">Build a knowledge graph of this project (needs graphify).</div>
      )}
    </div>
  );
}
