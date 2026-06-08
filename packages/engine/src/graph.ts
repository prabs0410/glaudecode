// Knowledge graph via graphify (Epic D §3.2). `graphify extract <dir>` (a Python tool)
// writes graphify-out/graph.json; we map it to nodes/edges for the UI. Python+graphify is
// an OPTIONAL dependency (locked decision): when it's absent the feature degrades to an
// enable-guide instead of crashing (§5). mapGraphJson is pure + tested and tolerant of
// graphify's exact field names; GraphManager runs the subprocess.

export interface GraphNode {
  id: string;
  label: string;
  kind: string;
}
export interface GraphEdge {
  from: string;
  to: string;
  kind: string;
}
export interface GraphResult {
  available: boolean;
  /** Why the graph isn't available (install guidance), when available is false. */
  reason?: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** True if the graph was capped (large-repo guard, §5). */
  truncated: boolean;
}

const MAX_NODES = 500;
const INSTALL_HINT =
  "Knowledge graph needs Python 3.10+ and graphify. Install graphify (pip install graphify) to enable.";

/** Map graphify's graph.json into nodes/edges. Pure, tolerant of field-name variants. */
export function mapGraphJson(json: any, maxNodes = MAX_NODES): { nodes: GraphNode[]; edges: GraphEdge[]; truncated: boolean } {
  const rawNodes: any[] = Array.isArray(json?.nodes) ? json.nodes : [];
  const rawEdges: any[] = Array.isArray(json?.edges)
    ? json.edges
    : Array.isArray(json?.links)
      ? json.links
      : Array.isArray(json?.relationships)
        ? json.relationships
        : [];

  const truncated = rawNodes.length > maxNodes;
  const nodes: GraphNode[] = rawNodes
    .slice(0, maxNodes)
    .map((n) => ({
      id: String(n?.id ?? n?.name ?? ""),
      label: String(n?.label ?? n?.name ?? n?.id ?? ""),
      kind: String(n?.kind ?? n?.type ?? "node"),
    }))
    .filter((n) => n.id);

  const keep = new Set(nodes.map((n) => n.id));
  const edges: GraphEdge[] = rawEdges
    .map((e) => ({
      from: String(e?.from ?? e?.source ?? ""),
      to: String(e?.to ?? e?.target ?? ""),
      kind: String(e?.kind ?? e?.type ?? "rel"),
    }))
    // Drop edges that reference nodes we dropped (e.g. via the cap).
    .filter((e) => e.from && e.to && keep.has(e.from) && keep.has(e.to));

  return { nodes, edges, truncated };
}

// ---------- subprocess ----------

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface GraphManagerOptions {
  /** graphify binary (injectable for tests). */
  bin?: string;
}

export class GraphManager {
  private readonly bin: string;
  constructor(opts: GraphManagerOptions = {}) {
    this.bin = opts.bin ?? "graphify";
  }

  /** Run graphify on a project and return its graph, or a graceful degrade result. */
  async buildGraph(projectDir: string): Promise<GraphResult> {
    const degraded = (reason: string): GraphResult => ({ available: false, reason, nodes: [], edges: [], truncated: false });

    let exitCode: number;
    let stderr: string;
    try {
      const proc = Bun.spawn([this.bin, "extract", projectDir], {
        cwd: projectDir,
        stdout: "ignore",
        stderr: "pipe",
      });
      [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    } catch {
      return degraded(INSTALL_HINT); // ENOENT — binary not on PATH
    }
    if (exitCode !== 0) return degraded(`graphify failed: ${stderr.trim() || `exit ${exitCode}`}`);

    let json: unknown;
    try {
      json = JSON.parse(await readFile(join(projectDir, "graphify-out", "graph.json"), "utf8"));
    } catch {
      return degraded("graphify produced no graph.json");
    }
    const { nodes, edges, truncated } = mapGraphJson(json);
    return { available: true, nodes, edges, truncated };
  }
}
