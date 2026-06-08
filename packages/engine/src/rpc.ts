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
import { buildChanges } from "./changes";
import { detectConflicts } from "./conflicts";
import { computeSessionCost } from "./cost";
import { WorktreeManager } from "./worktree";
import { buildHandoffSummary } from "./handoff";
import { generateObservations } from "./metaAgent";
import { computeContextUsage } from "./contextUsage";
import { suggestModel, latestUserPrompt } from "./modelSuggestion";
import { ApprovalHookInstaller } from "./approvalHook";
import type { ApprovalQueue, FinalDecision } from "./approvalQueue";
import { CostStore, evaluateBudget, type Budget } from "./budget";
import { MemoryStore, parseLoadedContext } from "./memory";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type RpcMethod =
  | "listSessions"
  | "getSessionInfo"
  | "getSessionMessages"
  | "forkSession"
  | "renameSession"
  | "tagSession"
  | "deleteSession"
  | "agentState"
  | "timeline"
  | "sessionCost"
  | "sessionChanges"
  | "conflicts"
  | "listWorktrees"
  | "createWorktree"
  | "removeWorktree"
  | "handoff"
  | "metaObservations"
  | "contextUsage"
  | "pendingApprovals"
  | "resolveApproval"
  | "installApprovalHook"
  | "uninstallApprovalHook"
  | "approvalHookStatus"
  | "budgetStatus"
  | "getBudget"
  | "setBudget"
  | "modelSuggestion"
  | "listMemory"
  | "readMemory"
  | "writeMemory"
  | "readProjectInstructions"
  | "writeProjectInstructions"
  | "loadedContext";

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
  "sessionCost",
  "sessionChanges",
  "conflicts",
  "listWorktrees",
  "createWorktree",
  "removeWorktree",
  "handoff",
  "metaObservations",
  "contextUsage",
  "pendingApprovals",
  "resolveApproval",
  "installApprovalHook",
  "uninstallApprovalHook",
  "approvalHookStatus",
  "budgetStatus",
  "getBudget",
  "setBudget",
  "modelSuggestion",
  "listMemory",
  "readMemory",
  "writeMemory",
  "readProjectInstructions",
  "writeProjectInstructions",
  "loadedContext",
]);

// Stateless wrappers; one instance each is fine to share across requests.
const defaultWorktrees = new WorktreeManager();
const defaultCostStore = new CostStore();
const defaultMemoryStore = new MemoryStore();

export interface DispatchDeps {
  worktrees?: WorktreeManager;
  /** Stateful approval queue (per-server); required for the approval RPCs. */
  approvals?: ApprovalQueue;
  /** This server's {port, token}, for writing the hook's endpoint file. */
  endpoint?: { port: number; token: string };
  /** Cost/budget persistence (injectable for tests). */
  costStore?: CostStore;
  /** Memory/instructions file access (injectable for tests). */
  memoryStore?: MemoryStore;
}

export async function dispatch(
  adapter: ClaudeCodeAdapter,
  method: string,
  params: any,
  deps: DispatchDeps = {},
): Promise<unknown> {
  const worktrees = deps.worktrees ?? defaultWorktrees;
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
    case "sessionCost": {
      const msgs = await adapter.getSessionMessages(req(p.id, "id"), { dir: req(p.dir, "dir") });
      return computeSessionCost(msgs);
    }
    case "sessionChanges": {
      const msgs = await adapter.getSessionMessages(req(p.id, "id"), { dir: req(p.dir, "dir") });
      return buildChanges(msgs);
    }
    case "conflicts": {
      // Each live pane runs in its own worktree, so a session's messages must be
      // read from *that pane's* dir — sessions bucket by cwd (Principle XI).
      const sessions: Array<{ id: string; dir: string }> = Array.isArray(p.sessions) ? p.sessions : [];
      const perSession = await Promise.all(
        sessions.map(async ({ id, dir }) => ({
          sessionId: id,
          changes: buildChanges(await adapter.getSessionMessages(id, { dir })),
        })),
      );
      return detectConflicts(perSession);
    }
    case "listWorktrees":
      return worktrees.listWorktrees(req(p.dir, "dir"));
    case "createWorktree":
      return {
        path: await worktrees.createWorktree(req(p.dir, "dir"), req(p.branch, "branch"), p.path ?? undefined),
      };
    case "removeWorktree":
      await worktrees.removeWorktree(req(p.dir, "dir"), req(p.path, "path"), !!p.force);
      return { ok: true };
    case "handoff": {
      // Build an injectable digest of where the source session left off. No live
      // messaging exists in Claude Code (§3.5); the UI pastes this into the target.
      const id = req(p.fromId, "fromId");
      const dir = req(p.dir, "dir");
      const [info, msgs] = await Promise.all([
        adapter.getSessionInfo(id, { dir }),
        adapter.getSessionMessages(id, { dir }),
      ]);
      return { prompt: buildHandoffSummary(msgs, { fromTitle: info?.title ?? info?.firstPrompt }) };
    }
    case "metaObservations": {
      // Advisory cross-session observations (Epic B §3.3). Off by default — the caller
      // (UI) only invokes this when the user turns the meta-agent on. Rule-based: no
      // model cost. `now` is overridable for deterministic tests.
      const sessions: Array<{ id: string; dir: string; title?: string }> = Array.isArray(p.sessions) ? p.sessions : [];
      const now = typeof p.now === "number" ? p.now : Date.now();
      const inputs = await Promise.all(
        sessions.map(async ({ id, dir, title }) => {
          const msgs = await adapter.getSessionMessages(id, { dir });
          return { sessionId: id, title, state: deriveAgentState(msgs, now), changes: buildChanges(msgs) };
        }),
      );
      return generateObservations(inputs, { now });
    }
    case "contextUsage": {
      const msgs = await adapter.getSessionMessages(req(p.id, "id"), { dir: req(p.dir, "dir") });
      return computeContextUsage(msgs);
    }
    case "pendingApprovals":
      return deps.approvals?.list() ?? [];
    case "resolveApproval": {
      const ok = deps.approvals?.resolve(req(p.id, "id"), req(p.decision, "decision") as FinalDecision) ?? false;
      return { ok };
    }
    case "installApprovalHook": {
      // Opt-in. Write this server's endpoint where the hook can read it, then merge the
      // PreToolUse hook into .claude/settings.json (reversible).
      const dir = req(p.dir, "dir");
      if (!deps.endpoint) throw new Error("engine endpoint unavailable");
      const endpointFile = join(dir, ".glaudecode", "approval-endpoint.json");
      await mkdir(dirname(endpointFile), { recursive: true });
      await writeFile(endpointFile, JSON.stringify(deps.endpoint), "utf8");
      const binPath = join(import.meta.dir, "..", "bin", "approval-hook.ts");
      await new ApprovalHookInstaller().install(dir, {
        command: `bun ${binPath} ${endpointFile}`,
        timeoutSec: 300,
      });
      return { ok: true };
    }
    case "uninstallApprovalHook":
      await new ApprovalHookInstaller().uninstall(req(p.dir, "dir"));
      return { ok: true };
    case "approvalHookStatus":
      return { installed: await new ApprovalHookInstaller().isInstalled(req(p.dir, "dir")) };
    case "budgetStatus": {
      // Today's spend = sum of the live sessions' estimated cost; total = that plus the
      // persisted prior-day rollup. Evaluate against the project's configured budget.
      const dir = req(p.dir, "dir");
      const store = deps.costStore ?? defaultCostStore;
      const sessions: Array<{ id: string; dir: string }> = Array.isArray(p.sessions) ? p.sessions : [];
      const usds = await Promise.all(
        sessions.map(async ({ id, dir: sdir }) =>
          computeSessionCost(await adapter.getSessionMessages(id, { dir: sdir })).usd,
        ),
      );
      const todayUsd = usds.reduce((a, b) => a + b, 0);
      const rollup = await store.readRollup(dir);
      const budget = await store.getBudget(dir);
      return evaluateBudget(budget, { dailyUsd: todayUsd, totalUsd: rollup.totalUsd + todayUsd });
    }
    case "getBudget":
      return (await (deps.costStore ?? defaultCostStore).getBudget(req(p.dir, "dir"))) ?? null;
    case "setBudget":
      await (deps.costStore ?? defaultCostStore).setBudget(req(p.dir, "dir"), req(p.budget, "budget") as Budget);
      return { ok: true };
    case "modelSuggestion": {
      const msgs = await adapter.getSessionMessages(req(p.id, "id"), { dir: req(p.dir, "dir") });
      const model = deriveAgentState(msgs, Date.now()).model;
      return suggestModel(latestUserPrompt(msgs), { currentModel: model });
    }
    case "listMemory":
      return (deps.memoryStore ?? defaultMemoryStore).listMemory(req(p.dir, "dir"));
    case "readMemory":
      return { content: await (deps.memoryStore ?? defaultMemoryStore).readMemory(req(p.dir, "dir"), req(p.path, "path")) };
    case "writeMemory":
      await (deps.memoryStore ?? defaultMemoryStore).writeMemory(req(p.dir, "dir"), req(p.path, "path"), req(p.content, "content"));
      return { ok: true };
    case "readProjectInstructions":
      return (await (deps.memoryStore ?? defaultMemoryStore).readProjectInstructions(req(p.dir, "dir"))) ?? null;
    case "writeProjectInstructions":
      return { path: await (deps.memoryStore ?? defaultMemoryStore).writeProjectInstructions(req(p.dir, "dir"), req(p.content, "content")) };
    case "loadedContext": {
      const msgs = await adapter.getSessionMessages(req(p.id, "id"), { dir: req(p.dir, "dir") }, { includeSystemMessages: true });
      return parseLoadedContext(msgs);
    }
  }
}

export interface RpcHandlerDeps {
  approvals?: ApprovalQueue;
  /** Mutable holder — the server fills in `port` after it binds. */
  endpoint?: { port: number; token: string };
}

export function createRpcHandler(adapter: ClaudeCodeAdapter, token: string, deps: RpcHandlerDeps = {}) {
  const authed = (request: Request) => request.headers.get("authorization") === `Bearer ${token}`;

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true });
    }

    // The PreToolUse hook POSTs pending tool calls here and blocks on the decision.
    if (url.pathname === "/approval") {
      if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
      if (!authed(request)) return new Response("unauthorized", { status: 401 });
      if (!deps.approvals) return Response.json({ decision: "deny", reason: "approvals unavailable" });
      let body: any;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: "invalid JSON body" }, { status: 400 });
      }
      if (!body?.tool) return Response.json({ error: "missing tool" }, { status: 400 });
      const result = await deps.approvals.submit({
        sessionId: String(body.sessionId ?? ""),
        tool: String(body.tool),
        input: body.input,
        repoDir: body.repoDir ? String(body.repoDir) : undefined,
      });
      return Response.json(result);
    }

    if (url.pathname !== "/rpc") return new Response("not found", { status: 404 });
    if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
    if (!authed(request)) return new Response("unauthorized", { status: 401 });

    let body: any;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }

    try {
      const result = await dispatch(adapter, body?.method, body?.params, {
        approvals: deps.approvals,
        endpoint: deps.endpoint,
      });
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
