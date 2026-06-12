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

  test("serves the cockpit at /app", async () => {
    const res = await fetch(`${base()}/app`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("GlaudeCode Cockpit");
  });

  test("/ws rejects an unauthenticated upgrade", async () => {
    const res = await fetch(`${base()}/ws?token=wrong`);
    expect(res.status).toBe(401);
  });

  test("remote listener is off by default; disable is idempotent (Epic G remote)", () => {
    const s = server.remote.status();
    expect(s.enabled).toBe(false);
    expect(s.hostname).toBeNull();
    expect(s.url).toBeNull();
    expect(s.port).toBe(server.port); // status reports the shared port even while off
    expect(server.remote.disable().enabled).toBe(false); // no-op when already off
  });

  test("a paired steer token answers an approval end-to-end", async () => {
    // Mint a pair code (local), redeem for a steer token, enqueue an approval, resolve it.
    const code = server.pairing.createPairCode("steer").code;
    const tok = server.pairing.redeem(code, "phone")!.token;
    const pending = server.approvals.submit({ sessionId: "s1", tool: "Bash", input: { command: "git push" } }, { timeoutMs: 5000 });
    await new Promise((r) => setTimeout(r, 5));
    const id = server.approvals.list()[0].id;
    const res = await fetch(`${base()}/rpc`, {
      method: "POST",
      headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
      body: JSON.stringify({ method: "resolveApproval", params: { id, decision: "allow" } }),
    });
    expect(res.status).toBe(200);
    expect(await pending).toMatchObject({ decision: "allow" });
  });
});
