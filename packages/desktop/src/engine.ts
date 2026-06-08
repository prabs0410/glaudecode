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
