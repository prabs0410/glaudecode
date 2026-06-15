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
import { PairingService, genPairCode } from "./pairing";
import { RateLimiter } from "./rateLimiter";
import { PaneHub } from "./paneHub";
import { decodeBridgeFrame } from "./bridgeProtocol";
import { decodeFrame } from "./termProtocol";
import { frameEvent } from "./remote";
import { COCKPIT_HTML, MANIFEST_JSON } from "./cockpit";
import { TERM_HTML } from "./termPage";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Engine-vendored xterm.js (self-hosted, no CDN — V5 Phase 1). Read once at startup as UTF-8 text
// (both are text assets); null if the vendor dir is missing (then it degrades to 503, not a crash).
function readVendor(name: string): string | null {
  try {
    return readFileSync(join(import.meta.dir, "..", "vendor", name), "utf8");
  } catch {
    return null;
  }
}
const XTERM_JS = readVendor("xterm.js");
const XTERM_CSS = readVendor("xterm.css");

/** Refuse to bind a wildcard interface (all interfaces) for the remote listener — only a
 *  specific address (e.g. the Mac's Tailscale IP) is allowed (V5 Phase 0.1). */
function isWildcardHost(h: string): boolean {
  const x = h.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  return x === "" || x === "0.0.0.0" || x === "::" || x === "*" || x === "::0" || x === "0:0:0:0:0:0:0:0";
}

/** Coerce a WebSocket binary message (Buffer / ArrayBuffer / typed array) to a Uint8Array. */
function toU8(raw: unknown): Uint8Array | null {
  if (raw instanceof Uint8Array) return raw;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (ArrayBuffer.isView(raw)) return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  return null;
}

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
    genCode: () => genPairCode(),
    genToken: () => crypto.randomUUID() + crypto.randomUUID().replace(/-/g, ""),
  });
  // Throttle /pair so the short code can't be brute-forced (V5 Phase 0.3). code-server baseline:
  // 2/min + 12/hr, keyed by client IP. A successful pair resets the IP's counter.
  const pairLimiter = new RateLimiter(() => Date.now(), [
    { windowMs: 60_000, max: 2 },
    { windowMs: 3_600_000, max: 12 },
  ]);
  // Mutable endpoint holder: the hook installer needs {port, token}, but the port is
  // only known after Bun.serve binds.
  const endpoint = { port: 0, token };

  // Live cockpit sockets; we push the approvals snapshot to them.
  const sockets = new Set<any>();
  // Terminal-mirror relay (V5 Phase 1): the Rust core tees pane PTY bytes here over /pane-bridge,
  // and cockpit phones attach over /term-ws to view them.
  const paneHub = new PaneHub();

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
      if (isWildcardHost(h)) {
        // Binding all interfaces would expose the cockpit (with its steer/approval RPCs) on the
        // LAN and, behind port-forwarding, the public internet — defeating the tailnet-only intent.
        throw new Error(`refusing to bind wildcard interface "${host}" — pass a specific address (e.g. your Tailscale IP)`);
      }
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

  const handler = createRpcHandler(adapter, token, { approvals, endpoint, pairing, remoteControl: remote, paneHub });

  // Shared Bun.serve config (websocket + fetch) reused by the localhost and remote listeners.
  const serveConfig = {
    websocket: {
      open(ws: any) {
        // Not authed yet — receive nothing, and auto-close if no valid auth frame arrives soon.
        ws.data.authTimer = setTimeout(() => {
          try {
            ws.close(4001, "auth timeout");
          } catch {
            /* already closed */
          }
        }, 5000);
      },
      message(ws: any, raw: any) {
        const kind = ws.data.kind;
        if (!ws.data.authed) {
          let msg: any;
          try {
            msg = JSON.parse(String(raw));
          } catch {
            return;
          }
          const close = () => {
            try {
              ws.close(4003, "unauthorized");
            } catch {
              /* already closed */
            }
          };
          if (msg?.type !== "auth") return close();
          const tok = String(msg.token ?? "");
          // AUTH BOUNDARY: the pane-bridge is the Rust core only → it authenticates with the engine
          // BEARER token (never a paired token), so a paired phone can never reach the PTY ingress,
          // even on the remote listener. /ws + /term-ws accept PAIRED tokens only (never the bearer).
          if (kind === "bridge") {
            if (tok !== token) return close();
          } else if (!pairing.verify(tok).ok) {
            return close();
          }
          ws.data.authed = true;
          clearTimeout(ws.data.authTimer);
          if (kind === "approvals") {
            sockets.add(ws);
            ws.send(frameEvent("approvals", approvals.list(), new Date().toISOString()));
          } else if (kind === "term") {
            const paneId = String(msg.paneId ?? "");
            if (!paneId) return close();
            ws.data.paneId = paneId;
            const sub = {
              send: (frame: Uint8Array) => {
                try {
                  ws.send(frame);
                } catch {
                  /* socket gone */
                }
              },
              close: () => {
                try {
                  ws.close(4002, "pane closed");
                } catch {
                  /* already closed */
                }
              },
            };
            ws.data.sub = sub;
            ws.data.detach = paneHub.attach(paneId, sub);
          }
          return;
        }
        // Authed:
        if (kind === "bridge") {
          const buf = toU8(raw);
          if (!buf) return;
          const f = decodeBridgeFrame(buf);
          if (f.type === "output") paneHub.ingest(f.paneId, f.data);
          else if (f.type === "size") paneHub.setSize(f.paneId, f.cols, f.rows);
          else if (f.type === "meta") paneHub.setMeta(f.paneId, f.title);
          else if (f.type === "close") paneHub.closePane(f.paneId);
        } else if (kind === "term") {
          const buf = toU8(raw);
          if (!buf) return;
          const f = decodeFrame(buf);
          if (f.type === "ack" && ws.data.paneId && ws.data.sub) {
            paneHub.ack(ws.data.paneId, ws.data.sub, f.bytes);
          }
        }
        // approvals: push-only — ignore any client messages.
      },
      close(ws: any) {
        clearTimeout(ws.data?.authTimer);
        sockets.delete(ws);
        ws.data?.detach?.(); // detach a term subscriber from its pane
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
      // The view-only terminal page + its vendored xterm.js (V5 Phase 1). All static; the RPCs/WS
      // they call are authed. The token lives in sessionStorage, never these URLs.
      if (request.method === "GET" && url.pathname === "/app/term") {
        return new Response(TERM_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (request.method === "GET" && url.pathname === "/app/xterm.js") {
        return XTERM_JS
          ? new Response(XTERM_JS, { headers: { "content-type": "text/javascript; charset=utf-8" } })
          : new Response("xterm.js not vendored", { status: 503 });
      }
      if (request.method === "GET" && url.pathname === "/app/xterm.css") {
        return XTERM_CSS
          ? new Response(XTERM_CSS, { headers: { "content-type": "text/css; charset=utf-8" } })
          : new Response("", { status: 503 });
      }

      // Pairing redemption: an unpaired client exchanges a short code (which IS the
      // credential — single-use + expiring) for a scoped token. No bearer required here, so it's
      // rate-limited + audited per IP to make the short code un-brute-forceable (V5 Phase 0.3).
      if (request.method === "POST" && url.pathname === "/pair") {
        const ip = srv.requestIP?.(request)?.address ?? "unknown";
        if (!pairLimiter.hit(ip)) {
          console.error(`[glaudecode] /pair rate-limited (${ip})`);
          return Response.json({ error: "too many attempts — slow down" }, { status: 429 });
        }
        const body = await request.json().catch(() => null);
        const tok = pairing.redeem(String(body?.code ?? "").trim().toUpperCase(), String(body?.name ?? "device"));
        if (!tok) {
          console.error(`[glaudecode] /pair failed redemption (${ip})`);
          return Response.json({ error: "invalid or expired pairing code" }, { status: 401 });
        }
        pairLimiter.reset(ip); // legit pair clears the counter so the user isn't locked out
        return Response.json(tok);
      }

      // Rust-core pane bridge (V5 Phase 1): the Rust core tees pane PTY bytes here. ENGINE-BEARER
      // only (enforced in websocket.message), so a paired phone can never reach the PTY ingress —
      // the auth boundary, not the bind, is what protects it.
      if (url.pathname === "/pane-bridge") {
        if (srv.upgrade(request, { data: { kind: "bridge", authed: false } })) return undefined;
        return new Response("expected websocket", { status: 426 });
      }
      // Cockpit terminal mirror (V5 Phase 1): a paired token + paneId in the first message attaches
      // the phone to a pane and streams framed output (view-only).
      if (url.pathname === "/term-ws") {
        if (srv.upgrade(request, { data: { kind: "term", authed: false } })) return undefined;
        return new Response("expected websocket", { status: 426 });
      }

      // WebSocket event stream. The token is NOT in the URL (V5 Phase 0.2 — query strings leak via
      // history/Referer/proxy logs, and the local bearer must never ride on /ws). We upgrade
      // unauthenticated, then require a paired token in the FIRST message (see websocket.message);
      // the socket receives nothing until authed and is closed if it doesn't auth promptly.
      if (url.pathname === "/ws") {
        if (srv.upgrade(request, { data: { kind: "approvals", authed: false } })) return undefined;
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
