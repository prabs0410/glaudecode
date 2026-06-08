// JSON-RPC-ish request handler for the engine. Pure and transport-agnostic: it
// takes a Request and returns a Response, so it can be unit-tested without binding
// a socket and reused by the desktop sidecar and (later) the hosted web/mobile tier.
//
// Protocol: POST /rpc  { "method": "listSessions", "params": {...} }
//   -> 200 { "result": ... }  |  4xx { "error": "..." }
// Auth: every /rpc call requires `Authorization: Bearer <token>`.
// GET /health -> { ok: true } (no auth) for readiness checks.

import { ClaudeCodeAdapter } from "./adapter";
import { deriveAgentState } from "./agentState";
import { buildTimeline } from "./timeline";

export type RpcMethod =
  | "listSessions"
  | "getSessionInfo"
  | "getSessionMessages"
  | "forkSession"
  | "renameSession"
  | "tagSession"
  | "deleteSession"
  | "agentState"
  | "timeline";

const METHODS = new Set<RpcMethod>([
  "listSessions",
  "getSessionInfo",
  "getSessionMessages",
  "forkSession",
  "renameSession",
  "tagSession",
  "deleteSession",
  "agentState",
  "timeline",
]);

export async function dispatch(
  adapter: ClaudeCodeAdapter,
  method: string,
  params: any,
): Promise<unknown> {
  if (!METHODS.has(method as RpcMethod)) {
    throw new Error(`unknown method: ${method}`);
  }
  const p = params ?? {};
  switch (method as RpcMethod) {
    case "listSessions":
      return adapter.listSessions({ dir: req(p.dir, "dir") });
    case "getSessionInfo":
      return adapter.getSessionInfo(req(p.id, "id"), { dir: req(p.dir, "dir") });
    case "getSessionMessages":
      return adapter.getSessionMessages(req(p.id, "id"), { dir: req(p.dir, "dir") }, p.options ?? {});
    case "forkSession":
      return adapter.forkSession(req(p.id, "id"), { dir: req(p.dir, "dir") }, p.options ?? {});
    case "renameSession":
      await adapter.renameSession(req(p.id, "id"), req(p.title, "title"), { dir: req(p.dir, "dir") });
      return { ok: true };
    case "tagSession":
      await adapter.tagSession(req(p.id, "id"), p.tag ?? null, { dir: req(p.dir, "dir") });
      return { ok: true };
    case "deleteSession":
      await adapter.deleteSession(req(p.id, "id"), { dir: req(p.dir, "dir") });
      return { ok: true };
    case "agentState": {
      const msgs = await adapter.getSessionMessages(req(p.id, "id"), { dir: req(p.dir, "dir") });
      return deriveAgentState(msgs, Date.now());
    }
    case "timeline": {
      const msgs = await adapter.getSessionMessages(req(p.id, "id"), { dir: req(p.dir, "dir") });
      return buildTimeline(msgs);
    }
  }
}

export function createRpcHandler(adapter: ClaudeCodeAdapter, token: string) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true });
    }
    if (url.pathname !== "/rpc") return new Response("not found", { status: 404 });
    if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
    if (request.headers.get("authorization") !== `Bearer ${token}`) {
      return new Response("unauthorized", { status: 401 });
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }

    try {
      const result = await dispatch(adapter, body?.method, body?.params);
      return Response.json({ result });
    } catch (e: any) {
      return Response.json({ error: String(e?.message ?? e) }, { status: 400 });
    }
  };
}

function req<T>(value: T | undefined | null, name: string): T {
  if (value === undefined || value === null) throw new Error(`missing required param: ${name}`);
  return value;
}
