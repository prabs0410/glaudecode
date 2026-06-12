// Localhost-only HTTP/WS server exposing the engine RPC + the remote cockpit. Binds
// 127.0.0.1 by default on an ephemeral port with a per-launch bearer token. The desktop app
// spawns this as a sidecar and reads {port, token} from the process's first stdout line.
//
// Epic G adds the cockpit: it serves the web client at /app and a /ws event stream that
// pushes live approvals. Remote access is EXPLICIT OPT-IN: pass a hostname to bind a chosen
// interface (meant to sit behind the user's transport — Tailscale/SSH tunnel/cloudflared,
// which provides TLS). The default stays localhost-only.
//
// NOTE: not compiled with `bun build --compile` — that breaks the Agent SDK's CLI
// resolution (SDK #150). Ship as a Bun script run by a bundled Bun runtime.

import { ClaudeCodeAdapter } from "./adapter";
import { createRpcHandler, type RemoteControl, type RemoteInfo } from "./rpc";
import { ApprovalQueue } from "./approvalQueue";
import { PairingService } from "./pairing";
import { frameEvent } from "./remote";
import { COCKPIT_HTML, MANIFEST_JSON } from "./cockpit";

export interface EngineServer {
  port: number;
  token: string;
  approvals: ApprovalQueue;
  pairing: PairingService;
  /** Start/stop a second listener on a network interface (Tailscale) — Epic G remote. */
  remote: RemoteControl;
  stop: () => void;
}

export interface StartOptions {
  /** Bearer token clients must present. Generated if omitted. */
  token?: string;
  /** Port to bind; 0 = ephemeral (default). */
  port?: number;
  /** Interface to bind. Default 127.0.0.1 (localhost-only). Setting any other value is
   *  the explicit opt-in to expose the cockpit remotely (use only behind a trusted,
   *  TLS-terminating transport). */
  hostname?: string;
}

export function startEngineServer(opts: StartOptions = {}): EngineServer {
  const token = opts.token ?? crypto.randomUUID();
  const hostname = opts.hostname ?? "127.0.0.1";
  const adapter = new ClaudeCodeAdapter();
  const approvals = new ApprovalQueue();
  // Pairing for the remote cockpit (Epic G): short human-typable codes, opaque tokens,
  // both random + held in memory only (no token at rest).
  const pairing = new PairingService({
    now: () => Date.now(),
    genCode: () => crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase(),
    genToken: () => crypto.randomUUID() + crypto.randomUUID().replace(/-/g, ""),
  });
  // Mutable endpoint holder: the hook installer needs {port, token}, but the port is
  // only known after Bun.serve binds.
  const endpoint = { port: 0, token };

  // Live cockpit sockets; we push the approvals snapshot to them.
  const sockets = new Set<any>();

  // Optional second listener bound to a network interface (e.g. the Mac's Tailscale IP). It
  // shares EVERYTHING with the localhost listener — same handler, token, pairing, sockets — so
  // a phone on the tailnet talks to the same engine. Enabling it is local-only (see rpc.ts).
  let remoteServer: ReturnType<typeof Bun.serve> | null = null;
  let remoteHost: string | null = null;
  const remoteInfo = (): RemoteInfo => ({
    enabled: remoteServer != null,
    hostname: remoteHost,
    port: endpoint.port,
    url: remoteHost ? `http://${remoteHost}:${endpoint.port}/app` : null,
  });
  const remote: RemoteControl = {
    enable(host: string) {
      const h = host.trim();
      if (!h) throw new Error("remote hostname required");
      if (remoteServer && remoteHost === h) return remoteInfo();
      if (remoteServer) remoteServer.stop(true);
      // Bind the SAME ephemeral port on the chosen interface (a distinct socket from localhost).
      remoteServer = Bun.serve({ hostname: h, port: endpoint.port, ...serveConfig });
      remoteHost = h;
      return remoteInfo();
    },
    disable() {
      remoteServer?.stop(true);
      remoteServer = null;
      remoteHost = null;
      return remoteInfo();
    },
    status: () => remoteInfo(),
  };

  const handler = createRpcHandler(adapter, token, { approvals, endpoint, pairing, remoteControl: remote });

  // Shared Bun.serve config (websocket + fetch) reused by the localhost and remote listeners.
  const serveConfig = {
    websocket: {
      open(ws: any) {
        sockets.add(ws);
        ws.send(frameEvent("approvals", approvals.list(), new Date().toISOString()));
      },
      close(ws: any) {
        sockets.delete(ws);
      },
      message() {
        /* cockpit is push-only for now; ignore client messages */
      },
    },
    async fetch(request: Request, srv: any): Promise<Response | undefined> {
      const url = new URL(request.url);

      // Serve the cockpit (static; no secrets — RPCs it calls are authed). PWA-installable.
      if (request.method === "GET" && url.pathname === "/app") {
        return new Response(COCKPIT_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (request.method === "GET" && url.pathname === "/app/manifest.json") {
        return new Response(MANIFEST_JSON, { headers: { "content-type": "application/manifest+json" } });
      }

      // Pairing redemption: an unpaired client exchanges a short code (which IS the
      // credential — single-use + expiring) for a scoped token. No bearer required here.
      if (request.method === "POST" && url.pathname === "/pair") {
        const body = await request.json().catch(() => null);
        const tok = pairing.redeem(String(body?.code ?? "").trim().toUpperCase(), String(body?.name ?? "device"));
        if (!tok) return Response.json({ error: "invalid or expired pairing code" }, { status: 401 });
        return Response.json(tok);
      }

      // WebSocket event stream — authenticated by token in the query (browsers can't set
      // headers on WS). Any valid token (local bearer or paired) may subscribe (view).
      if (url.pathname === "/ws") {
        const t = url.searchParams.get("token") ?? "";
        const authed = t === token || pairing.verify(t).ok;
        if (!authed) return new Response("unauthorized", { status: 401 });
        if (srv.upgrade(request)) return undefined;
        return new Response("expected websocket", { status: 426 });
      }

      return handler(request);
    },
  };

  const server = Bun.serve({ hostname, port: opts.port ?? 0, ...serveConfig });

  if (server.port == null) {
    server.stop(true);
    throw new Error("engine server failed to bind a TCP port");
  }
  endpoint.port = server.port;

  // Push live approvals to cockpit sockets (the EventBus push stream will replace this).
  const broadcast = setInterval(() => {
    if (sockets.size === 0) return;
    const frame = frameEvent("approvals", approvals.list(), new Date().toISOString());
    for (const ws of sockets) ws.send(frame);
  }, 2000);
  (broadcast as any)?.unref?.();

  return {
    port: server.port,
    token,
    approvals,
    pairing,
    remote,
    stop: () => {
      clearInterval(broadcast);
      approvals.clear();
      remote.disable();
      server.stop(true);
    },
  };
}
