// Unit tests for the RPC handler + dispatch. Uses a stub adapter so they're fully
// portable (no SDK, no sessions). Covers auth, routing, validation, and errors.

import { describe, expect, test } from "bun:test";
import { createRpcHandler, dispatch } from "../src/rpc";
import type { ClaudeCodeAdapter } from "../src/adapter";

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
