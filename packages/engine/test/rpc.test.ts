// Unit tests for the RPC handler + dispatch. Uses a stub adapter so they're fully
// portable (no SDK, no sessions). Covers auth, routing, validation, and errors.

import { describe, expect, test } from "bun:test";
import { createRpcHandler, dispatch } from "../src/rpc";
import type { ClaudeCodeAdapter } from "../src/adapter";
import type { WorktreeManager } from "../src/worktree";

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

    expect(await dispatch(stubAdapter(), "listWorktrees", { dir: "/repo" }, wt)).toEqual([
      { path: "/repo", isMain: true, locked: false, detached: false },
    ]);
    expect(await dispatch(stubAdapter(), "createWorktree", { dir: "/repo", branch: "feat-x" }, wt)).toEqual({ path: "/wt/new" });
    expect(await dispatch(stubAdapter(), "removeWorktree", { dir: "/repo", path: "/wt/new", force: true }, wt)).toEqual({ ok: true });
    expect(calls).toEqual([
      ["list", "/repo"],
      ["create", "/repo", "feat-x", undefined],
      ["remove", "/repo", "/wt/new", true],
    ]);
  });

  test("createWorktree requires a branch", async () => {
    await expect(dispatch(stubAdapter(), "createWorktree", { dir: "/repo" })).rejects.toThrow(/missing required param: branch/);
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
