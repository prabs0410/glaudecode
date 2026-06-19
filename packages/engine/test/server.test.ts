// End-to-end server test: binds a real ephemeral localhost port and exercises the
// HTTP surface. Portable — no sessions required (health + auth only).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startEngineServer, type EngineServer } from "../src/server";
import {
  decodeBridgeFrame,
  encodeBridgeArm,
  encodeBridgeMeta,
  encodeBridgeOutput,
  encodeBridgeSize,
} from "../src/bridgeProtocol";
import { decodeFrame, encodeInput, encodeResize } from "../src/termProtocol";

function asU8(d: unknown): Uint8Array {
  if (d instanceof Uint8Array) return d;
  if (d instanceof ArrayBuffer) return new Uint8Array(d);
  return new Uint8Array(d as ArrayBufferLike);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function openWs(path: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}${path}`);
  ws.binaryType = "arraybuffer";
  return new Promise((resolve) => {
    ws.onopen = () => resolve(ws);
  });
}
/** Stand in for the Rust core's input sink: connect /pane-input-bridge (engine-bearer) and collect
 *  the bridge frames the engine pushes to it. */
async function openInputSink(): Promise<{ ws: WebSocket; frames: ReturnType<typeof decodeBridgeFrame>[] }> {
  const ws = await openWs("/pane-input-bridge");
  const frames: ReturnType<typeof decodeBridgeFrame>[] = [];
  ws.onmessage = (e) => frames.push(decodeBridgeFrame(asU8(e.data)));
  ws.send(JSON.stringify({ type: "auth", token: "e2e-token" }));
  await sleep(40);
  return { ws, frames };
}

let server: EngineServer;
const base = () => `http://127.0.0.1:${server.port}`;

beforeAll(() => {
  // resizeGraceMs:200 so the resize-authority (V6 P1.7) is testable with timing margin: a phone may
  // resize once the desk has been quiet 200ms; a desktopHeartbeat re-blocks it. (Production default 30s.)
  server = startEngineServer({ token: "e2e-token", resizeGraceMs: 200 });
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

  test("diagnostics() returns the event stream + health + APM metrics for the local bearer; paired tokens are forbidden (OBS-2)", async () => {
    // generate some RPC traffic so the stream + metrics have content
    await fetch(`${base()}/rpc`, {
      method: "POST",
      headers: { authorization: "Bearer e2e-token", "content-type": "application/json" },
      body: JSON.stringify({ method: "defaultDir", params: {} }),
    });
    const res = await fetch(`${base()}/rpc`, {
      method: "POST",
      headers: { authorization: "Bearer e2e-token", "content-type": "application/json" },
      body: JSON.stringify({ method: "diagnostics", params: { limit: 50 } }),
    });
    expect(res.status).toBe(200);
    const { result } = await res.json();
    expect(result.health.engineUp).toBe(true);
    expect(typeof result.health.uptimeMs).toBe("number");
    expect(Array.isArray(result.events)).toBe(true);
    // the defaultDir call we just made was timed + recorded in the stream + the APM metrics
    expect(result.events.some((e: any) => e.kind === "rpc" && e.data?.method === "defaultDir")).toBe(true);
    expect(result.metrics.some((m: any) => m.method === "defaultDir")).toBe(true);
    // diagnostics is LOCAL-ONLY: a paired steer token is forbidden (reveals cross-device activity like the audit log)
    const tok = server.pairing.redeem(server.pairing.createPairCode("steer").code, "diag-deny")!.token;
    const denied = await fetch(`${base()}/rpc`, {
      method: "POST",
      headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
      body: JSON.stringify({ method: "diagnostics", params: {} }),
    });
    expect(denied.status).toBe(403);
  });

  test("diagnosticsView is steer-scoped + privacy-safe (only rpc/ws/engine/phone kinds); a view token is 403 (OBS-4)", async () => {
    const steer = server.pairing.redeem(server.pairing.createPairCode("steer").code, "phone-dbg")!.token;
    const res = await fetch(`${base()}/rpc`, {
      method: "POST",
      headers: { authorization: `Bearer ${steer}`, "content-type": "application/json" },
      body: JSON.stringify({ method: "diagnosticsView", params: {} }),
    });
    expect(res.status).toBe(200);
    const { result } = await res.json();
    expect(result.health.engineUp).toBe(true);
    expect(Array.isArray(result.events)).toBe(true);
    // the phone view NEVER leaks the sensitive kinds (pair/revoke/audit/bridge)
    expect(result.events.every((e: any) => ["rpc", "ws", "engine", "phone"].includes(e.kind))).toBe(true);
    // a view token can't reach it (requires steer)
    const view = server.pairing.redeem(server.pairing.createPairCode("view").code, "view-dbg")!.token;
    const denied = await fetch(`${base()}/rpc`, {
      method: "POST",
      headers: { authorization: `Bearer ${view}`, "content-type": "application/json" },
      body: JSON.stringify({ method: "diagnosticsView", params: {} }),
    });
    expect(denied.status).toBe(403);
  });

  test("/clientlog-remote: a paired device forwards an error into the observability stream; no token → 401 (OBS-3)", async () => {
    const tok = server.pairing.redeem(server.pairing.createPairCode("view").code, "phone-log")!.token;
    const res = await fetch(`${base()}/clientlog-remote`, {
      method: "POST",
      headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
      body: JSON.stringify({ level: "error", kind: "unhandledrejection", msg: "boom on the phone", where: "/app/chat" }),
    });
    expect(res.status).toBe(200);
    // it lands in the same EventLog stream (read via diagnostics with the local bearer)
    const diag = await (
      await fetch(`${base()}/rpc`, {
        method: "POST",
        headers: { authorization: "Bearer e2e-token", "content-type": "application/json" },
        body: JSON.stringify({ method: "diagnostics", params: { kinds: ["phone"] } }),
      })
    ).json();
    expect(diag.result.events.some((e: any) => e.kind === "phone" && e.msg.includes("boom on the phone"))).toBe(true);
    // an unpaired caller is refused
    const denied = await fetch(`${base()}/clientlog-remote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ msg: "x" }),
    });
    expect(denied.status).toBe(401);
  });

  test("serves the cockpit at /app", async () => {
    const res = await fetch(`${base()}/app`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("GlaudeCode Cockpit");
  });

  test("serves the terminal page + vendored xterm.js, no CDN (V5 Phase 1)", async () => {
    const page = await fetch(`${base()}/app/term`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("GlaudeCode Terminal");
    const xterm = await fetch(`${base()}/app/xterm.js`);
    expect(xterm.status).toBe(200);
    expect(xterm.headers.get("content-type")).toContain("javascript");
    expect((await xterm.text()).length).toBeGreaterThan(10000); // the real vendored lib, not a stub
  });

  test("/ws without a websocket upgrade returns 426", async () => {
    const res = await fetch(`${base()}/ws`);
    expect(res.status).toBe(426);
  });

  test("/ws authenticates via the first message — a valid paired token gets the approvals snapshot (V5 Phase 0.2)", async () => {
    const code = server.pairing.createPairCode("view").code;
    const tok = server.pairing.redeem(code, "phone-ws")!.token;
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    const frame = await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no message")), 3000);
      ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token: tok }));
      ws.onmessage = (e) => {
        clearTimeout(timer);
        resolve(JSON.parse(String(e.data)));
      };
    });
    ws.close();
    expect(frame.type).toBe("approvals");
  });

  test("/ws closes a socket that sends a bad token, leaking no data (V5 Phase 0.2)", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    const outcome = await new Promise<string>((resolve) => {
      let gotMessage = false;
      const timer = setTimeout(() => resolve(gotMessage ? "message" : "silent"), 2000);
      ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token: "not-a-real-token" }));
      ws.onmessage = () => {
        gotMessage = true;
      };
      ws.onclose = () => {
        clearTimeout(timer);
        resolve("closed");
      };
    });
    expect(outcome).toBe("closed");
  });

  test("/ws redacts approval input for a view device, full payload for steer (audit M1)", async () => {
    // A view (read-only) device must not receive the tool input (the exact command + paths).
    server.approvals.submit(
      { sessionId: "m1-sess", tool: "Bash", input: { command: "git push origin secret-branch" } },
      { timeoutMs: 5000 },
    );
    await sleep(5);
    const firstFrame = (token: string) =>
      new Promise<any>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
        const timer = setTimeout(() => reject(new Error("no frame")), 3000);
        ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token }));
        ws.onmessage = (e) => {
          clearTimeout(timer);
          resolve(JSON.parse(String(e.data)));
          ws.close();
        };
      });

    const viewTok = server.pairing.redeem(server.pairing.createPairCode("view").code, "view-dev")!.token;
    const viewFrame = await firstFrame(viewTok);
    const va = viewFrame.payload.find((x: any) => x.sessionId === "m1-sess");
    expect(va).toBeTruthy();
    expect(va.tool).toBe("Bash"); // view still SEES an approval is pending…
    expect(va.input).toBeUndefined(); // …but NEVER the command/paths
    expect(va.reason).toBeUndefined();
    expect(va.redacted).toBe(true);

    const steerTok = server.pairing.redeem(server.pairing.createPairCode("steer").code, "steer-dev")!.token;
    const steerFrame = await firstFrame(steerTok);
    const sa = steerFrame.payload.find((x: any) => x.sessionId === "m1-sess");
    expect(sa.input).toEqual({ command: "git push origin secret-branch" }); // steer can act → full payload

    for (const p of server.approvals.list()) server.approvals.resolve(p.id, "deny"); // cleanup
  });

  test("remote.enable refuses a wildcard interface (V5 Phase 0.1)", () => {
    expect(() => server.remote.enable("0.0.0.0")).toThrow(/wildcard/);
    expect(() => server.remote.enable("::")).toThrow(/wildcard/);
    expect(server.remote.status().enabled).toBe(false); // never bound
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

  test("/pane-bridge rejects a paired token — it's engine-bearer only (V5 Phase 1 auth boundary)", async () => {
    const code = server.pairing.createPairCode("steer").code;
    const tok = server.pairing.redeem(code, "phone")!.token;
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/pane-bridge`);
    const outcome = await new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve("stayed-open"), 1500);
      ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token: tok })); // paired, not the bearer
      ws.onclose = () => {
        clearTimeout(timer);
        resolve("closed");
      };
    });
    expect(outcome).toBe("closed");
  });

  test("bridge ingest -> term attach receives output; listPanes lists the pane (V5 Phase 1)", async () => {
    const paneId = "pane-e2e-1";
    // Rust-core side: connect /pane-bridge with the ENGINE BEARER token, send meta + size + output.
    const bridge = new WebSocket(`ws://127.0.0.1:${server.port}/pane-bridge`);
    await new Promise<void>((res) => {
      bridge.onopen = () => res();
    });
    bridge.send(JSON.stringify({ type: "auth", token: "e2e-token" }));
    await new Promise((r) => setTimeout(r, 40));
    bridge.send(encodeBridgeMeta(paneId, "my session"));
    bridge.send(encodeBridgeSize(paneId, 90, 30));
    bridge.send(encodeBridgeOutput(paneId, new TextEncoder().encode("hello-phone")));
    await new Promise((r) => setTimeout(r, 40));

    // Phone side: attach /term-ws with a paired VIEW token + paneId → receive the (replayed) output.
    const code = server.pairing.createPairCode("view").code;
    const tok = server.pairing.redeem(code, "phone")!.token;
    const term = new WebSocket(`ws://127.0.0.1:${server.port}/term-ws`);
    term.binaryType = "arraybuffer";
    const text = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no output")), 3000);
      let buf = "";
      term.onopen = () => term.send(JSON.stringify({ type: "auth", token: tok, paneId }));
      term.onmessage = (e) => {
        const f = decodeFrame(asU8(e.data));
        if (f.type === "output") {
          buf += new TextDecoder().decode(f.data);
          if (buf.includes("hello-phone")) {
            clearTimeout(timer);
            resolve(buf);
          }
        }
      };
    });
    expect(text).toContain("hello-phone");

    // listPanes (view scope) shows the pane with its meta.
    const res = await fetch(`${base()}/rpc`, {
      method: "POST",
      headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
      body: JSON.stringify({ method: "listPanes", params: {} }),
    });
    const body = await res.json();
    expect(body.result.find((p: any) => p.paneId === paneId)?.title).toBe("my session");
    bridge.close();
    term.close();
  });

  test("/pane-input-bridge rejects a paired token — engine-bearer only (V5 Phase 2 auth boundary)", async () => {
    const tok = server.pairing.redeem(server.pairing.createPairCode("terminal").code, "phone")!.token;
    const ws = await openWs("/pane-input-bridge");
    const outcome = await new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve("stayed-open"), 1500);
      ws.send(JSON.stringify({ type: "auth", token: tok })); // a paired token, not the engine bearer
      ws.onclose = () => {
        clearTimeout(timer);
        resolve("closed");
      };
    });
    expect(outcome).toBe("closed");
  });

  test("terminal-scope token types into an ARMED pane; engine relays to the Rust input sink (V5 Phase 2)", async () => {
    const paneId = "pane-input-armed";
    const sink = await openInputSink();
    // Rust core arms the pane over the (output) /pane-bridge.
    const bridge = await openWs("/pane-bridge");
    bridge.send(JSON.stringify({ type: "auth", token: "e2e-token" }));
    await sleep(40);
    bridge.send(encodeBridgeMeta(paneId, "armed session"));
    bridge.send(encodeBridgeArm(paneId, true));
    await sleep(40);

    // Phone: a TERMINAL-scope token attaches and types.
    const tok = server.pairing.redeem(server.pairing.createPairCode("terminal").code, "phone")!.token;
    const term = await openWs("/term-ws");
    term.send(JSON.stringify({ type: "auth", token: tok, paneId }));
    await sleep(40);
    term.send(encodeInput(new TextEncoder().encode("ls\r")));
    await sleep(60);

    const input = sink.frames.find((f) => f.type === "input" && f.paneId === paneId);
    expect(input).toBeTruthy();
    if (input && input.type === "input") expect(new TextDecoder().decode(input.data)).toBe("ls\r");
    sink.ws.close();
    bridge.close();
    term.close();
  });

  test("a STEER token cannot type — terminal scope is never implied by steer (V5 Phase 2)", async () => {
    const paneId = "pane-input-steer";
    const sink = await openInputSink();
    const bridge = await openWs("/pane-bridge");
    bridge.send(JSON.stringify({ type: "auth", token: "e2e-token" }));
    await sleep(40);
    bridge.send(encodeBridgeArm(paneId, true)); // pane IS armed — isolate that SCOPE is the gate
    await sleep(40);

    const tok = server.pairing.redeem(server.pairing.createPairCode("steer").code, "phone")!.token;
    const term = await openWs("/term-ws");
    term.send(JSON.stringify({ type: "auth", token: tok, paneId }));
    await sleep(40);
    term.send(encodeInput(new TextEncoder().encode("rm -rf ~\r")));
    await sleep(60);

    expect(sink.frames.some((f) => f.type === "input")).toBe(false); // nothing reached the PTY sink
    sink.ws.close();
    bridge.close();
    term.close();
  });

  test("a TERMINAL token cannot type into an UNARMED pane (default-off arming, V5 Phase 2)", async () => {
    const paneId = "pane-input-unarmed";
    const sink = await openInputSink();
    const bridge = await openWs("/pane-bridge");
    bridge.send(JSON.stringify({ type: "auth", token: "e2e-token" }));
    await sleep(40);
    bridge.send(encodeBridgeMeta(paneId, "not armed")); // pane exists but is NOT armed
    await sleep(40);

    const tok = server.pairing.redeem(server.pairing.createPairCode("terminal").code, "phone")!.token;
    const term = await openWs("/term-ws");
    term.send(JSON.stringify({ type: "auth", token: tok, paneId }));
    await sleep(40);
    term.send(encodeInput(new TextEncoder().encode("whoami\r")));
    await sleep(60);

    expect(sink.frames.some((f) => f.type === "input")).toBe(false); // unarmed pane → no input relayed
    sink.ws.close();
    bridge.close();
    term.close();
  });

  test("revoking a device cuts its LIVE terminal session — input stops immediately (Phase 2 review #1)", async () => {
    const paneId = "pane-revoke";
    const sink = await openInputSink();
    const bridge = await openWs("/pane-bridge");
    bridge.send(JSON.stringify({ type: "auth", token: "e2e-token" }));
    await sleep(40);
    bridge.send(encodeBridgeArm(paneId, true));
    await sleep(40);

    const dev = server.pairing.redeem(server.pairing.createPairCode("terminal").code, "phone")!;
    const term = await openWs("/term-ws");
    term.send(JSON.stringify({ type: "auth", token: dev.token, paneId }));
    await sleep(40);
    term.send(encodeInput(new TextEncoder().encode("before\r")));
    await sleep(60);
    const before = sink.frames.filter((f) => f.type === "input").length;
    expect(before).toBeGreaterThan(0); // typing worked while the token was valid

    server.pairing.revoke(dev.deviceId); // user hits "Revoke" on the desktop
    term.send(encodeInput(new TextEncoder().encode("after\r")));
    await sleep(60);
    const after = sink.frames.filter((f) => f.type === "input").length;
    expect(after).toBe(before); // the revoked token's keystrokes are NOT relayed (re-verified per frame)
    sink.ws.close();
    bridge.close();
    term.close();
  });

  test("revoking a device cuts its LIVE /ws approvals feed via the sweep (audit H3)", async () => {
    // The /ws approvals stream carries the more sensitive payload (tool + full input + sessionId) yet
    // was only verified at first-message auth. The 2s sweep must re-verify it like termSockets.
    const dev = server.pairing.redeem(server.pairing.createPairCode("steer").code, "ws-revoke")!;
    const ws = await openWs("/ws");
    let snapshots = 0;
    ws.onmessage = (e) => {
      try {
        if (JSON.parse(String(e.data)).type === "approvals") snapshots++;
      } catch {
        /* not JSON */
      }
    };
    const closed = new Promise<number>((resolve) => {
      ws.onclose = (e) => resolve(e.code);
    });
    ws.send(JSON.stringify({ type: "auth", token: dev.token }));
    await sleep(60);
    expect(snapshots).toBeGreaterThan(0); // received the live feed while authorized

    server.pairing.revoke(dev.deviceId); // user hits "Revoke"
    const code = await Promise.race([closed, sleep(2600).then(() => -1)]);
    expect(code).toBe(4003); // the sweep force-closed the revoked approvals stream (not left streaming)
  });

  test("a terminal+armed RESIZE relays to the Rust sink; a steer RESIZE is dropped (V5 Phase 4)", async () => {
    const paneId = "pane-resize";
    const sink = await openInputSink();
    const bridge = await openWs("/pane-bridge");
    bridge.send(JSON.stringify({ type: "auth", token: "e2e-token" }));
    await sleep(40);
    bridge.send(encodeBridgeArm(paneId, true));
    await sleep(40);

    // A steer token's RESIZE is dropped (same gate as INPUT — terminal scope required).
    const steer = server.pairing.redeem(server.pairing.createPairCode("steer").code, "p")!.token;
    const t1 = await openWs("/term-ws");
    t1.send(JSON.stringify({ type: "auth", token: steer, paneId }));
    await sleep(40);
    t1.send(encodeResize(120, 40));
    await sleep(50);
    expect(sink.frames.some((f) => f.type === "resize")).toBe(false);
    t1.close();

    // A terminal token's RESIZE on an armed pane relays through as a bridge resize frame.
    const term = server.pairing.redeem(server.pairing.createPairCode("terminal").code, "p")!.token;
    const t2 = await openWs("/term-ws");
    t2.send(JSON.stringify({ type: "auth", token: term, paneId }));
    await sleep(40);
    t2.send(encodeResize(120, 40));
    await sleep(50);
    const rz = sink.frames.find((f) => f.type === "resize" && f.paneId === paneId);
    expect(rz).toBeTruthy();
    if (rz && rz.type === "resize") {
      expect(rz.cols).toBe(120);
      expect(rz.rows).toBe(40);
    }
    sink.ws.close();
    bridge.close();
    t2.close();
  });

  test("a terminal+armed RESIZE is DROPPED while a desktop viewer is present (V6 P1.7)", async () => {
    const paneId = "pane-resize-auth";
    const sink = await openInputSink();
    const bridge = await openWs("/pane-bridge");
    bridge.send(JSON.stringify({ type: "auth", token: "e2e-token" }));
    await sleep(40);
    bridge.send(encodeBridgeArm(paneId, true));
    await sleep(40);
    const term = server.pairing.redeem(server.pairing.createPairCode("terminal").code, "p")!.token;
    const t = await openWs("/term-ws");
    t.send(JSON.stringify({ type: "auth", token: term, paneId }));
    await sleep(40);
    // The desktop reports it's focused (local-bearer heartbeat) — so the phone must NOT reshape the
    // shared PTY. Send the RESIZE immediately after, well within the 200ms grace.
    await fetch(`${base()}/rpc`, {
      method: "POST",
      headers: { authorization: "Bearer e2e-token", "content-type": "application/json" },
      body: JSON.stringify({ method: "desktopHeartbeat", params: {} }),
    });
    t.send(encodeResize(120, 40));
    await sleep(60);
    expect(sink.frames.some((f) => f.type === "resize" && f.paneId === paneId)).toBe(false);
    sink.ws.close();
    bridge.close();
    t.close();
  });

  test("oversized INPUT is dropped and RESIZE is clamped to a sane range (audit M2)", async () => {
    const paneId = "pane-m2";
    const sink = await openInputSink();
    const bridge = await openWs("/pane-bridge");
    bridge.send(JSON.stringify({ type: "auth", token: "e2e-token" }));
    await sleep(40);
    bridge.send(encodeBridgeArm(paneId, true));
    await sleep(40);

    const term = server.pairing.redeem(server.pairing.createPairCode("terminal").code, "p")!.token;
    const t = await openWs("/term-ws");
    t.send(JSON.stringify({ type: "auth", token: term, paneId }));
    await sleep(40);

    // Oversized INPUT (> 256 KiB) is dropped — never relayed to the PTY sink.
    const before = sink.frames.filter((f) => f.type === "input").length;
    t.send(encodeInput(new Uint8Array(300 * 1024)));
    await sleep(60);
    expect(sink.frames.filter((f) => f.type === "input").length).toBe(before);

    // A normal INPUT still relays (the cap never touches real input).
    t.send(encodeInput(new TextEncoder().encode("ls\r")));
    await sleep(60);
    expect(sink.frames.filter((f) => f.type === "input").length).toBe(before + 1);

    // A 0 x 65535 RESIZE is clamped to 1..1000 before it can reach the real PTY.
    t.send(encodeResize(0, 65535));
    await sleep(60);
    const rz = sink.frames.filter((f) => f.type === "resize" && f.paneId === paneId).pop();
    expect(rz).toBeTruthy();
    if (rz && rz.type === "resize") {
      expect(rz.cols).toBe(1);
      expect(rz.rows).toBe(1000);
    }
    sink.ws.close();
    bridge.close();
    t.close();
  });

  test("/term-ws attach to a pane the bridge never announced is refused with 4002 (audit M12)", async () => {
    // A phone must not be able to conjure a phantom pane — the wire path must close (4002) when the
    // engine's PaneHub has no record of the paneId (no bridge META/SIZE/ARM/output ever arrived).
    const tok = server.pairing.redeem(server.pairing.createPairCode("terminal").code, "phone")!.token;
    const term = await openWs("/term-ws");
    const closed = new Promise<number>((resolve) => {
      term.onclose = (e) => resolve(e.code);
    });
    term.send(JSON.stringify({ type: "auth", token: tok, paneId: "never-announced-pane" }));
    const code = await Promise.race([closed, sleep(1000).then(() => -1)]);
    expect(code).toBe(4002);
  });

  // Last: this consumes 127.0.0.1's /pair budget. Other tests redeem via server.pairing directly,
  // not the HTTP endpoint, so they're unaffected.
  test("/pair is rate-limited per IP (V5 Phase 0.3)", async () => {
    const attempt = () =>
      fetch(`${base()}/pair`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "BADCODE0", name: "x" }),
      });
    const r1 = await attempt(); // allowed → invalid code → 401
    const r2 = await attempt(); // allowed → 401
    const r3 = await attempt(); // exceeds 2/min → 429
    expect(r1.status).toBe(401);
    expect(r2.status).toBe(401);
    expect(r3.status).toBe(429);
  });
});
