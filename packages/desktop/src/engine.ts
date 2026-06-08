// Renderer-side client for the @glaudecode/engine sidecar. Gets the {port, token}
// from the Rust core (which spawned the engine) and calls its localhost RPC. This
// is the only path the UI uses to reach Claude Code data.

import { invoke } from "@tauri-apps/api/core";

interface Endpoint {
  port: number;
  token: string;
}

let cached: Endpoint | null = null;

async function endpoint(): Promise<Endpoint> {
  if (!cached) cached = await invoke<Endpoint>("engine_endpoint");
  return cached;
}

export async function engineRpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const { port, token } = await endpoint();
  const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `engine rpc ${method} failed (${res.status})`);
  return body.result as T;
}

export interface SessionSummary {
  id: string;
  title?: string;
  firstPrompt?: string;
  summary?: string;
  gitBranch?: string;
  cwd?: string;
  tag?: string;
  lastModified?: string;
}

/** Nearest git repo root at/above the app cwd — the project to list sessions for. */
export const projectDir = () => invoke<string>("project_dir");

export const listSessions = (dir: string) => engineRpc<SessionSummary[]>("listSessions", { dir });

export const renameSession = (id: string, title: string, dir: string) =>
  engineRpc<{ ok: true }>("renameSession", { id, title, dir });

export const tagSession = (id: string, tag: string | null, dir: string) =>
  engineRpc<{ ok: true }>("tagSession", { id, tag, dir });

export const deleteSession = (id: string, dir: string) =>
  engineRpc<{ ok: true }>("deleteSession", { id, dir });

export interface AgentState {
  status: "idle" | "thinking" | "running-tool";
  toolName?: string;
  model?: string;
  sinceMs?: number;
}

/** Computed server-side by the engine (deriveAgentState, tested there). */
export const agentState = (id: string, dir: string) =>
  engineRpc<AgentState>("agentState", { id, dir });

export type TimelineEntry =
  | { kind: "thinking"; id: string; text: string; timestamp?: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      input: unknown;
      status: "pending" | "ok" | "error";
      timestamp?: string;
    };

/** Computed server-side by the engine (buildTimeline, tested there). */
export const timeline = (id: string, dir: string) =>
  engineRpc<TimelineEntry[]>("timeline", { id, dir });

export interface ChangeEntry {
  path: string;
  edits: number;
  lastTool: string;
}

/** Computed server-side by the engine (buildChanges, tested there). */
export const sessionChanges = (id: string, dir: string) =>
  engineRpc<ChangeEntry[]>("sessionChanges", { id, dir });

export interface SessionCost {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  usd: number;
  unpricedTokens: number;
}

/** Computed server-side by the engine (computeSessionCost, tested there). */
export const sessionCost = (id: string, dir: string) =>
  engineRpc<SessionCost>("sessionCost", { id, dir });

// Frontend mirror of @glaudecode/engine's filterSessions. Behavior is verified by
// that package's tests (test/filter.test.ts); kept in sync deliberately rather than
// importing the engine package (which pulls the Node-only Agent SDK) into the bundle.
export function filterSessions(sessions: SessionSummary[], query: string): SessionSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return sessions;
  const terms = q.split(/\s+/);
  return sessions.filter((s) => {
    const haystack = [s.title, s.firstPrompt, s.summary, s.gitBranch, s.tag, s.cwd]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });
}
