// End-to-end server test: binds a real ephemeral localhost port and exercises the
// HTTP surface. Portable — no sessions required (health + auth only).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startEngineServer, type EngineServer } from "../src/server";

let server: EngineServer;
const base = () => `http://127.0.0.1:${server.port}`;

beforeAll(() => {
  server = startEngineServer({ token: "e2e-token" });
});
afterAll(() => server.stop());

describe("engine server", () => {
  test("binds an ephemeral port and serves /health", async () => {
    expect(server.port).toBeGreaterThan(0);
    const res = await fetch(`${base()}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("/rpc rejects unauthorized requests", async () => {
    const res = await fetch(`${base()}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "listSessions", params: { dir: "/r" } }),
    });
    expect(res.status).toBe(401);
  });

  test("/rpc serves an authorized call end-to-end", async () => {
    const res = await fetch(`${base()}/rpc`, {
      method: "POST",
      headers: { authorization: "Bearer e2e-token", "content-type": "application/json" },
      body: JSON.stringify({ method: "listSessions", params: { dir: process.cwd() } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.result)).toBe(true);
  });
});
