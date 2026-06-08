// Unit tests for the RPC handler + dispatch. Uses a stub adapter so they're fully
// portable (no SDK, no sessions). Covers auth, routing, validation, and errors.

import { afterAll, describe, expect, test } from "bun:test";
import { createRpcHandler, dispatch } from "../src/rpc";
import type { ClaudeCodeAdapter } from "../src/adapter";
import type { WorktreeManager } from "../src/worktree";
import { ApprovalQueue } from "../src/approvalQueue";
import { CostStore } from "../src/budget";
import { SearchIndex } from "../src/searchIndex";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TOKEN = "test-token";

function stubAdapter(overrides: Partial<ClaudeCodeAdapter> = {}): ClaudeCodeAdapter {
  return {
    listSessions: async () => [{ id: "s1" }],
    getSessionInfo: async () => ({ id: "s1" }),
    getSessionMessages: async () => [],
    forkSession: async () => ({ sessionId: "fork-1" }),
    renameSession: async () => {},
    tagSession: async () => {},
    ...overrides,
  } as unknown as ClaudeCodeAdapter;
}

function rpc(handler: (r: Request) => Promise<Response>, body: unknown, token = TOKEN) {
  return handler(
    new Request("http://127.0.0.1/rpc", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("dispatch", () => {
  test("routes listSessions with dir", async () => {
    let seen: any;
    const a = stubAdapter({ listSessions: async (scope: any) => ((seen = scope), [{ id: "s1" }]) as any });
    const out = await dispatch(a, "listSessions", { dir: "/repo" });
    expect(seen).toEqual({ dir: "/repo" });
    expect(out).toEqual([{ id: "s1" }]);
  });

  test("rejects unknown method", async () => {
    await expect(dispatch(stubAdapter(), "deleteEverything", {})).rejects.toThrow(/unknown method/);
  });

  test("requires params", async () => {
    await expect(dispatch(stubAdapter(), "getSessionMessages", { dir: "/r" })).rejects.toThrow(/missing required param: id/);
  });

  test("tagSession passes null to clear", async () => {
    let seenTag: any = "unset";
    const a = stubAdapter({ tagSession: async (_id: any, tag: any) => void (seenTag = tag) });
    await dispatch(a, "tagSession", { id: "s1", dir: "/r" });
    expect(seenTag).toBeNull();
  });

  test("agentState computes from session messages", async () => {
    const a = stubAdapter({
      getSessionMessages: async () =>
        [{ id: "m", role: "user", timestamp: new Date().toISOString(), blocks: [] }] as any,
    });
    const out: any = await dispatch(a, "agentState", { id: "s1", dir: "/r" });
    expect(out.status).toBe("thinking");
  });

  test("timeline computes tool/thinking entries from messages", async () => {
    const a = stubAdapter({
      getSessionMessages: async () =>
        [
          { id: "m", role: "assistant", blocks: [{ kind: "tool_use", id: "t1", name: "Bash", input: {} }] },
        ] as any,
    });
    const out: any = await dispatch(a, "timeline", { id: "s1", dir: "/r" });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "tool", name: "Bash", status: "pending" });
  });

  test("sessionChanges lists files from write tools", async () => {
    const a = stubAdapter({
      getSessionMessages: async () =>
        [
          { id: "m", role: "assistant", blocks: [{ kind: "tool_use", name: "Write", input: { file_path: "/x.ts" } }] },
        ] as any,
    });
    const out: any = await dispatch(a, "sessionChanges", { id: "s1", dir: "/r" });
    expect(out).toEqual([{ path: "/x.ts", edits: 1, lastTool: "Write" }]);
  });

  test("conflicts reads each session from its own worktree dir", async () => {
    const seen: Array<{ id: string; dir: string }> = [];
    const a = stubAdapter({
      getSessionMessages: async (id: any, scope: any) => {
        seen.push({ id, dir: scope.dir });
        // both sessions touch /shared.ts → one conflict
        return [
          { id: "m", role: "assistant", blocks: [{ kind: "tool_use", name: "Edit", input: { file_path: "/shared.ts" } }] },
        ] as any;
      },
    });
    const out: any = await dispatch(a, "conflicts", {
      sessions: [
        { id: "s1", dir: "/wt/a" },
        { id: "s2", dir: "/wt/b" },
      ],
    });
    expect(seen).toEqual([
      { id: "s1", dir: "/wt/a" },
      { id: "s2", dir: "/wt/b" },
    ]);
    expect(out).toEqual([{ path: "/shared.ts", sessionIds: ["s1", "s2"] }]);
  });

  test("routes worktree methods to the manager", async () => {
    const calls: any[] = [];
    const wt = {
      listWorktrees: async (dir: string) => (calls.push(["list", dir]), [{ path: dir, isMain: true, locked: false, detached: false }]),
      createWorktree: async (dir: string, branch: string, path?: string) => (calls.push(["create", dir, branch, path]), "/wt/new"),
      removeWorktree: async (dir: string, path: string, force?: boolean) => void calls.push(["remove", dir, path, force]),
    } as unknown as WorktreeManager;

    expect(await dispatch(stubAdapter(), "listWorktrees", { dir: "/repo" }, { worktrees: wt })).toEqual([
      { path: "/repo", isMain: true, locked: false, detached: false },
    ]);
    expect(await dispatch(stubAdapter(), "createWorktree", { dir: "/repo", branch: "feat-x" }, { worktrees: wt })).toEqual({ path: "/wt/new" });
    expect(await dispatch(stubAdapter(), "removeWorktree", { dir: "/repo", path: "/wt/new", force: true }, { worktrees: wt })).toEqual({ ok: true });
    expect(calls).toEqual([
      ["list", "/repo"],
      ["create", "/repo", "feat-x", undefined],
      ["remove", "/repo", "/wt/new", true],
    ]);
  });

  test("createWorktree requires a branch", async () => {
    await expect(dispatch(stubAdapter(), "createWorktree", { dir: "/repo" })).rejects.toThrow(/missing required param: branch/);
  });

  test("handoff returns an injectable digest of the source session", async () => {
    const a = stubAdapter({
      getSessionInfo: async () => ({ id: "s1", title: "parser work" }) as any,
      getSessionMessages: async () =>
        [{ id: "m", role: "assistant", blocks: [{ kind: "text", text: "added the parser" }] }] as any,
    });
    const out: any = await dispatch(a, "handoff", { fromId: "s1", dir: "/r" });
    expect(out.prompt).toContain('handed off from session "parser work"');
    expect(out.prompt).toContain("added the parser");
  });

  test("handoff requires fromId", async () => {
    await expect(dispatch(stubAdapter(), "handoff", { dir: "/r" })).rejects.toThrow(/missing required param: fromId/);
  });

  test("metaObservations surfaces a finished session from its computed state", async () => {
    const now = 1_700_000_000_000;
    const a = stubAdapter({
      getSessionMessages: async () =>
        [
          {
            id: "m1",
            role: "assistant",
            timestamp: new Date(now - 10_000).toISOString(),
            blocks: [{ kind: "tool_use", name: "Write", input: { file_path: "/x.ts" } }],
          },
          // Latest message is a plain text turn → no pending tool → idle.
          { id: "m2", role: "assistant", timestamp: new Date(now).toISOString(), blocks: [{ kind: "text", text: "done" }] },
        ] as any,
    });
    const out: any = await dispatch(a, "metaObservations", {
      now,
      sessions: [{ id: "s1", dir: "/r", title: "work" }],
    });
    // idle (last turn is text) + one changed file (from the earlier Write) → finished
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "finished:s1", level: "info" });
  });
});

describe("createRpcHandler", () => {
  test("GET /health needs no auth", async () => {
    const h = createRpcHandler(stubAdapter(), TOKEN);
    const res = await h(new Request("http://127.0.0.1/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("rejects missing/invalid token", async () => {
    const h = createRpcHandler(stubAdapter(), TOKEN);
    const res = await rpc(h, { method: "listSessions", params: { dir: "/r" } }, "wrong");
    expect(res.status).toBe(401);
  });

  test("returns result for a valid call", async () => {
    const h = createRpcHandler(stubAdapter(), TOKEN);
    const res = await rpc(h, { method: "listSessions", params: { dir: "/r" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: [{ id: "s1" }] });
  });

  test("400 on bad JSON", async () => {
    const h = createRpcHandler(stubAdapter(), TOKEN);
    const res = await h(
      new Request("http://127.0.0.1/rpc", {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
        body: "{not json",
      }),
    );
    expect(res.status).toBe(400);
  });

  test("400 with error message on unknown method", async () => {
    const h = createRpcHandler(stubAdapter(), TOKEN);
    const res = await rpc(h, { method: "nope", params: {} });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/unknown method/);
  });

  test("404 on unknown path", async () => {
    const h = createRpcHandler(stubAdapter(), TOKEN);
    const res = await h(new Request("http://127.0.0.1/other"));
    expect(res.status).toBe(404);
  });
});

describe("/approval endpoint + approval RPCs", () => {
  const post = (h: any, body: unknown, path = "/approval", token = TOKEN) =>
    h(
      new Request(`http://127.0.0.1${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  test("auto-allows a read-only tool", async () => {
    const approvals = new ApprovalQueue();
    const h = createRpcHandler(stubAdapter(), TOKEN, { approvals });
    const res = await post(h, { sessionId: "s1", tool: "Read", input: { file_path: "/x" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ decision: "allow" });
  });

  test("requires auth and a tool", async () => {
    const approvals = new ApprovalQueue();
    const h = createRpcHandler(stubAdapter(), TOKEN, { approvals });
    expect((await post(h, { tool: "Read" }, "/approval", "wrong")).status).toBe(401);
    expect((await post(h, { sessionId: "s1" })).status).toBe(400);
  });

  test("an 'ask' is pending until resolved via RPC, then the POST resolves", async () => {
    const approvals = new ApprovalQueue();
    const h = createRpcHandler(stubAdapter(), TOKEN, { approvals });
    const pending = post(h, { sessionId: "s1", tool: "Bash", input: { command: "git push" } });

    // Let the handler parse the body and enqueue before we inspect the queue.
    await new Promise((r) => setTimeout(r, 5));
    // It should now be listed via the RPC.
    const list: any = await dispatch(stubAdapter(), "pendingApprovals", {}, { approvals });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ tool: "Bash", dangerous: true });

    await dispatch(stubAdapter(), "resolveApproval", { id: list[0].id, decision: "allow" }, { approvals });
    const res = await pending;
    expect(await res.json()).toMatchObject({ decision: "allow" });
    expect(approvals.list()).toEqual([]);
  });
});

describe("budget RPCs", () => {
  const homes: string[] = [];
  test("setBudget then budgetStatus reflects live session spend", async () => {
    const home = await mkdtemp(join(tmpdir(), "glaude-rpc-cost-"));
    homes.push(home);
    const costStore = new CostStore(home);
    const dir = "/repo";

    // An assistant message worth some opus tokens so computeSessionCost > 0.
    const a = stubAdapter({
      getSessionMessages: async () =>
        [{ id: "m", role: "assistant", model: "claude-opus-4-8", blocks: [], usage: { inputTokens: 1_000_000 } }] as any,
    });

    await dispatch(a, "setBudget", { dir, budget: { dailyUsd: 10, warnPct: 0.8 } }, { costStore });
    const status: any = await dispatch(a, "budgetStatus", { dir, sessions: [{ id: "s1", dir }] }, { costStore });
    // 1M input tokens * $15/M = $15 → over the $10 daily cap
    expect(status.dailyUsd).toBeCloseTo(15, 1);
    expect(status.state).toBe("over");
  });

  afterAll(async () => {
    for (const h of homes) await rm(h, { recursive: true, force: true });
  });
});

describe("search RPCs", () => {
  test("reindex then search returns matching sessions; delete evicts", async () => {
    const searchIndex = new SearchIndex();
    const a = stubAdapter({
      listSessions: async () => [{ id: "s1" }, { id: "s2" }] as any,
      getSessionMessages: async (id: string) =>
        [
          {
            id: "m",
            role: "assistant",
            blocks: [{ kind: "text", text: id === "s1" ? "worktree porcelain parser" : "cost token estimate" }],
          },
        ] as any,
      deleteSession: async () => {},
    });

    const reindexed: any = await dispatch(a, "reindex", { dir: "/repo" }, { searchIndex });
    expect(reindexed).toEqual({ indexed: 2 });

    const hits: any = await dispatch(a, "search", { query: "worktree" }, { searchIndex });
    expect(hits).toHaveLength(1);
    expect(hits[0].sessionId).toBe("s1");

    await dispatch(a, "deleteSession", { id: "s1", dir: "/repo" }, { searchIndex });
    expect(await dispatch(a, "search", { query: "worktree" }, { searchIndex })).toEqual([]);
    searchIndex.close();
  });
});
