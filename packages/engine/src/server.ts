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
import { DesktopPresence } from "./resizeAuthority";
import { AuditLog, type AuditEvent } from "./audit";
import { EventLog } from "./eventLog";
import { decodeBridgeFrame, encodeBridgeInput, encodeBridgeResize } from "./bridgeProtocol";
import { decodeFrame } from "./termProtocol";
import { frameEvent } from "./remote";
import { COCKPIT_HTML, MANIFEST_JSON } from "./cockpit";
import { TERM_HTML } from "./termPage";
import { CONVERSATION_HTML } from "./conversationPage";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { safeUploadName, uniqueUploadName, UPLOAD_SUBDIR, MAX_UPLOAD_BYTES } from "./upload";

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
// xterm FitAddon (UMD, exposes globalThis.FitAddon.FitAddon) — sizes cols/rows to the phone viewport
// so mobile output isn't cropped (V6 Phase 1.2). Served like xterm.js; the served term page can't import.
const ADDON_FIT_JS = readVendor("addon-fit.js");

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
  /** Observability event hub (OBS-2) — exposed for tests + the diagnostics surface. */
  eventLog: EventLog;
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
  /** Resize-authority grace (V6 P1.7): ms of desktop quiet before a phone may reshape the PTY.
   *  Default 30s; tests set it small. */
  resizeGraceMs?: number;
  /** Base directory uploads land under (in `<uploadDir>/.glaudecode-uploads/`). Default process.cwd()
   *  — the engine sidecar's project dir. Injected so tests target a temp dir, never the repo (V6). */
  uploadDir?: string;
  /** Max upload size in bytes (default 25 MiB). Injected small in tests so the cap is exercised with
   *  tiny bodies. */
  maxUploadBytes?: number;
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
  // Bounds on the RCE channel (audit M2). A per-frame byte cap stops a single absurd INPUT frame; a
  // per-device token bucket stops a flood of INPUT/RESIZE frames. Real typing/paste stays far under
  // both (a fast keyboard is tens of frames/sec; a paste is one frame). Dropped frames are audited.
  const MAX_INPUT_BYTES = 256 * 1024; // 256 KiB — generous for paste, absurd for a keystroke flood
  const inputLimiter = new RateLimiter(() => Date.now(), [{ windowMs: 1_000, max: 500 }]);
  // Phone error-pipe limiter (OBS-3): cap a device's forwarded errors so a crash-loop can't flood the
  // log. 60/min is generous for genuine error bursts.
  const clientlogLimiter = new RateLimiter(() => Date.now(), [{ windowMs: 60_000, max: 60 }]);
  const clampDim = (n: number) => Math.max(1, Math.min(1000, Math.trunc(n) || 1)); // 1..1000 cols/rows
  // Mutable endpoint holder: the hook installer needs {port, token}, but the port is
  // only known after Bun.serve binds.
  const endpoint = { port: 0, token };

  // Live cockpit sockets; we push the approvals snapshot to them.
  const sockets = new Set<any>();
  // Terminal-mirror relay (V5 Phase 1): the Rust core tees pane PTY bytes here over /pane-bridge,
  // and cockpit phones attach over /term-ws to view them.
  const paneHub = new PaneHub();
  // The Rust core's INPUT sink (V5 Phase 2): a second, engine-bearer-only WS the Rust core dials
  // (/pane-input-bridge) so the engine can push phone keystrokes back to the PTY. One Rust core =
  // at most one such socket. Kept separate from the (output) /pane-bridge so the high-volume output
  // path stays a simple low-latency one-way stream and this stays a simple one-way input stream.
  let inputBridge: any = null;
  // Live phone mirror sockets (/term-ws). Tracked so revocation/expiry can actively tear down a
  // live session — a paired token is re-verified per INPUT frame AND swept here every 2s, so a
  // revoked device stops typing (and stops viewing) instead of running until its socket happens to
  // close (Phase 2 security review, finding #1).
  const termSockets = new Set<any>();
  // Cap concurrent UNAUTHED sockets so an attacker can't exhaust resources by opening sockets that
  // just sit until the 5s auth timeout (audit L2). Real clients authenticate in their first message.
  const MAX_UNAUTHED = 64;
  let unauthedSockets = 0;
  const dropUnauthed = (ws: any) => {
    if (ws.data?.unauthedCounted) {
      ws.data.unauthedCounted = false;
      unauthedSockets--;
    }
  };
  // Coarse, privacy-preserving audit of the RCE channel (V5 Phase 3.3.2): terminal auth, arming
  // changes, INPUT (paneId + byte COUNT, never bytes), and revoke/expiry/link-down disconnects.
  // Observability event hub (OBS-2): one privacy-safe stream the diagnostics() RPC reads. The audit
  // log MIRRORS into it, so RCE-channel activity (terminal-auth / arm / input / upload / disconnect)
  // shows up in diagnostics without touching any call site. Metadata only — never payloads.
  const startedAt = Date.now();
  const eventLog = new EventLog(() => Date.now());
  const auditToEvent = (e: AuditEvent) => {
    const data: Record<string, string | number | boolean> = { type: e.type };
    if (e.deviceId) data.deviceId = e.deviceId.slice(0, 8);
    if (e.paneId) data.paneId = e.paneId.slice(0, 8);
    if (typeof e.bytes === "number") data.bytes = e.bytes;
    if (e.name) data.name = e.name;
    if (e.reason) data.reason = e.reason;
    eventLog.record({ kind: "audit", level: e.type === "input-dropped" || e.reason ? "warn" : "info", msg: "audit " + e.type, data });
  };
  const audit = new AuditLog(() => Date.now(), 1000, auditToEvent);
  // Resize authority (V6 P1.7): a phone may reshape the shared PTY only when no desktop viewer is
  // present (the desktop WebView heartbeats while focused via the desktopHeartbeat RPC).
  const desktopPresence = new DesktopPresence(() => Date.now(), opts.resizeGraceMs);
  // RCE gate shared by INPUT + RESIZE (V5 Phase 2/4): a /term-ws control frame may reach the PTY
  // only when the socket's scope is exactly "terminal", its token STILL verifies (so a revoked/
  // expired token is cut immediately, not just on the next socket close), and the target pane is
  // armed. Returns the paneId, or null (closing the socket on revocation). The Rust core re-checks
  // arming authoritatively before touching the PTY (defense in depth).
  const gateTerminal = (ws: any): string | null => {
    if (ws.data.scope !== "terminal") return null;
    const rv = pairing.verify(ws.data.token ?? "");
    if (!rv.ok || rv.scope !== "terminal") {
      audit.record({ type: "disconnect", deviceId: ws.data.deviceId, reason: "revoked-or-expired" });
      console.error("[audit] terminal device cut (revoked/expired)");
      try {
        ws.close(4003, "token revoked or expired");
      } catch {
        /* already closed */
      }
      return null;
    }
    const paneId = ws.data.paneId;
    return paneId && paneHub.canInput(paneId) ? paneId : null;
  };
  // RESIZE authority (V6 P1.7): a phone reshaping the shared PTY narrows the desk's terminal under the
  // user, so beyond the INPUT gate it ALSO requires that no desktop viewer is present (the desktop
  // heartbeats while focused). Render-only otherwise — the phone just follows the Mac's SIZE.
  const gateResize = (ws: any): string | null => {
    const paneId = gateTerminal(ws);
    if (!paneId) return null;
    if (!desktopPresence.phoneMayResize()) {
      audit.record({ type: "input-dropped", deviceId: ws.data.deviceId, paneId, reason: "resize-denied-desktop-active" });
      return null;
    }
    return paneId;
  };
  // Scope the /ws approvals feed (audit M1). Only steer+ devices — which CAN resolve approvals — get
  // the full payload. A view (read-only) device gets a REDACTED list: it can still see that an
  // approval is pending (count, tool, dangerous flag) but never the tool `input` (the exact Bash
  // command + file paths) or the `reason`, which it has no business reading and can't act on.
  const approvalsForScope = (scope: string | undefined) => {
    const list = approvals.list();
    if (scope === "steer" || scope === "terminal") return list;
    return list.map((a) => ({
      id: a.id,
      sessionId: a.sessionId,
      tool: a.tool,
      dangerous: a.dangerous,
      redacted: true,
    }));
  };
  // Forward a gated control frame to the Rust input sink, or FAIL CLOSED: if the sink is down, close
  // the phone socket (4504) so the user isn't typing into a void — the phone reconnects when the
  // bridge is back (Phase 2 deferred LOW / Phase 3 hardening 3.3.1).
  const relayToBridge = (ws: any, frame: Uint8Array): void => {
    if (!inputBridge) {
      try {
        ws.close(4504, "input link down");
      } catch {
        /* already closed */
      }
      return;
    }
    try {
      inputBridge.send(frame);
    } catch {
      try {
        ws.close(4504, "input link down");
      } catch {
        /* already closed */
      }
    }
  };

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
      // V6 P2.3 / Epic-G must-harden: this listener now accepts paired tokens from anyone who can reach
      // the interface on the tailnet. Tailscale's default ACL is allow-all and Tailnet Lock is off — so
      // remind the operator to scope the engine port to the phone's identity (deny-by-default grant) and
      // enable Tailnet Lock before relying on remote bind. HTTPS (the secure context clipboard/PWA-install
      // /push need) requires Tailscale Serve + MagicDNS certs — the bare-IP URL is WireGuard-encrypted but
      // not a secure context. Self-host alternatives: docs/design/transport-options-phone-to-mac.md.
      console.error(
        `[glaudecode] remote cockpit bound on ${h}:${endpoint.port} — HARDEN the tailnet: add a deny-by-default ` +
          `ACL grant scoping this port to your phone's identity, and enable Tailnet Lock. For HTTPS ` +
          `(clipboard/install/push), enable Tailscale Serve + MagicDNS certs.`,
      );
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

  const handler = createRpcHandler(adapter, token, {
    approvals, endpoint, pairing, remoteControl: remote, paneHub, audit, desktopPresence,
    eventLog, startedAt, bridgeConnected: () => inputBridge != null,
  });

  // Shared Bun.serve config (websocket + fetch) reused by the localhost and remote listeners.
  const serveConfig = {
    websocket: {
      open(ws: any) {
        // Cap concurrent unauthed sockets (L2): reject immediately when over the limit.
        if (unauthedSockets >= MAX_UNAUTHED) {
          try {
            ws.close(1013, "server busy");
          } catch {
            /* already closed */
          }
          return;
        }
        unauthedSockets++;
        ws.data.unauthedCounted = true;
        // Not authed yet — receive nothing, and auto-close if no valid auth frame arrives soon. unref
        // so this timer never holds the process open at shutdown (L2).
        ws.data.authTimer = setTimeout(() => {
          try {
            ws.close(4001, "auth timeout");
          } catch {
            /* already closed */
          }
        }, 5000);
        ws.data.authTimer?.unref?.();
      },
      message(ws: any, raw: any) {
        const kind = ws.data.kind;
        if (!ws.data.authed) {
          const close = () => {
            try {
              ws.close(4003, "unauthorized");
            } catch {
              /* already closed */
            }
          };
          let msg: any;
          try {
            msg = JSON.parse(String(raw));
          } catch {
            return close(); // a non-JSON pre-auth frame → close, don't sit open until timeout (L11)
          }
          if (msg?.type !== "auth") return close();
          const tok = String(msg.token ?? "");
          // AUTH BOUNDARY: the pane bridges are the Rust core only → they authenticate with the
          // engine BEARER token (never a paired token), so a paired phone can never reach the PTY
          // ingress OR egress, even on the remote listener. /ws + /term-ws accept PAIRED tokens only
          // (never the bearer); the term socket's SCOPE is captured here and re-checked per INPUT.
          if (kind === "bridge" || kind === "inbridge") {
            if (tok !== token) return close();
          } else {
            const v = pairing.verify(tok);
            if (!v.ok) return close();
            ws.data.scope = v.scope; // "view" | "steer" | "terminal" — gates INPUT (Phase 2)
            ws.data.token = tok; // kept so the token can be RE-verified later (revocation/expiry)
            ws.data.deviceId = v.deviceId; // for the audit trail
          }
          ws.data.authed = true;
          dropUnauthed(ws); // now authed — free its unauthed slot (L2)
          clearTimeout(ws.data.authTimer);
          if (kind === "approvals") {
            sockets.add(ws);
            ws.send(frameEvent("approvals", approvalsForScope(ws.data.scope), new Date().toISOString()));
          } else if (kind === "inbridge") {
            // The Rust core's input delivery socket — the engine pushes phone keystrokes here. Close
            // any stale bridge before replacing it, so a reconnect race can't leak the old socket or
            // fan frames out to a dead one (audit L11).
            if (inputBridge && inputBridge !== ws) {
              try {
                inputBridge.close(1012, "replaced by a new input bridge");
              } catch {
                /* already closed */
              }
            }
            inputBridge = ws;
            eventLog.record({ kind: "bridge", level: "info", msg: "bridge connected (Rust input sink)" });
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
            const detach = paneHub.attach(paneId, sub);
            if (!detach) {
              // Refuse a paneId the Rust bridge never announced — never conjure a phantom pane (M12).
              try {
                ws.close(4002, "no such pane");
              } catch {
                /* already closed */
              }
              return;
            }
            ws.data.detach = detach;
            termSockets.add(ws); // so revocation/expiry can force-close this live mirror
            if (ws.data.scope === "terminal") {
              audit.record({ type: "terminal-auth", deviceId: ws.data.deviceId, paneId });
              console.error("[audit] terminal device attached pane " + paneId.slice(0, 8));
            }
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
          else if (f.type === "arm") {
            paneHub.setArmed(f.paneId, f.armed);
            audit.record({ type: f.armed ? "arm" : "disarm", paneId: f.paneId });
          }
        } else if (kind === "term") {
          const buf = toU8(raw);
          if (!buf) return;
          const f = decodeFrame(buf);
          if (f.type === "ack" && ws.data.paneId && ws.data.sub) {
            paneHub.ack(ws.data.paneId, ws.data.sub, f.bytes);
          } else if (f.type === "input") {
            // RCE GATE (V5 Phase 2): keystrokes reach the PTY only via gateTerminal (terminal scope +
            // live token + armed pane). The Rust core re-checks arming before writing (defense in depth).
            const paneId = gateTerminal(ws);
            if (paneId) {
              // Bounds (M2): drop an oversized frame or one over the per-device rate, and audit it —
              // never relay it. Real input never trips these; a flood/abuse does.
              if (f.data.length > MAX_INPUT_BYTES) {
                audit.record({ type: "input-dropped", deviceId: ws.data.deviceId, paneId, bytes: f.data.length, reason: "oversized" });
              } else if (!inputLimiter.hit(ws.data.deviceId ?? "anon")) {
                audit.record({ type: "input-dropped", deviceId: ws.data.deviceId, paneId, reason: "rate-limited" });
              } else {
                audit.record({ type: "input", deviceId: ws.data.deviceId, paneId, bytes: f.data.length });
                relayToBridge(ws, encodeBridgeInput(paneId, f.data));
              }
            }
          } else if (f.type === "resize") {
            // RESIZE is RCE-adjacent (mutates the desktop pane) — gated like INPUT (V5 Phase 4) PLUS the
            // resize-authority check (V6 P1.7: only when no desktop viewer is present), rate-limited, and
            // clamped to 1..1000 so a 0x0 / 65535 frame can't reach the real PTY (M2).
            const paneId = gateResize(ws);
            if (paneId && inputLimiter.hit(ws.data.deviceId ?? "anon")) {
              relayToBridge(ws, encodeBridgeResize(paneId, clampDim(f.cols), clampDim(f.rows)));
            }
          }
        }
        // approvals + inbridge: no inbound client messages to handle.
      },
      close(ws: any) {
        clearTimeout(ws.data?.authTimer);
        dropUnauthed(ws); // free its unauthed slot if it closed before authenticating (L2)
        sockets.delete(ws);
        termSockets.delete(ws);
        if (ws === inputBridge) {
          inputBridge = null; // Rust input sink gone (it reconnects)
          eventLog.record({ kind: "bridge", level: "warn", msg: "bridge disconnected (Rust input sink)" });
        }
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
      // Diagnostic: the desktop WebView forwards uncaught errors here (the WebView console isn't
      // visible in the terminal otherwise). Bearer-gated so only the local app can post.
      if (request.method === "POST" && url.pathname === "/clientlog") {
        if (request.headers.get("authorization") !== `Bearer ${token}`) {
          return new Response("unauthorized", { status: 401 });
        }
        const t = await request.text().catch(() => "");
        console.error("[client] " + t.slice(0, 4000));
        return new Response("ok");
      }

      // Phone -> Mac error pipe (OBS-3): a PAIRED device forwards its uncaught errors / failed RPCs so
      // they land in the SAME observability stream + durable log as everything else — the lid-closed
      // founder's primary surface must not fail silently. Any paired token (view+) may report; per-device
      // rate-limited + body-capped; truncated to a level + a short message + where (never a payload).
      if (request.method === "POST" && url.pathname === "/clientlog-remote") {
        const auth = request.headers.get("authorization") || "";
        const tok = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        const v = pairing.verify(tok);
        if (!v.ok) return Response.json({ error: "unauthorized" }, { status: 401 });
        if (Number(request.headers.get("content-length") || 0) > 8192) return Response.json({ error: "too large" }, { status: 413 });
        if (!clientlogLimiter.hit(v.deviceId ?? "anon")) return Response.json({ error: "rate-limited" }, { status: 429 });
        const body = await request.json().catch(() => null);
        if (!body) return Response.json({ error: "invalid body" }, { status: 400 });
        const level = body.level === "warn" ? "warn" : "error";
        const msg = String(body.msg ?? "client error").slice(0, 300);
        const kind = String(body.kind ?? "error").slice(0, 40);
        const dev = String(v.deviceId ?? "anon").slice(0, 8);
        const data: Record<string, string | number | boolean> = { deviceId: dev, kind };
        if (body.where) data.where = String(body.where).slice(0, 60);
        eventLog.record({ kind: "phone", level, msg: "phone " + kind + ": " + msg, data });
        console.error(`[phone:${dev}] ${kind}: ${msg}${body.where ? " @ " + String(body.where).slice(0, 60) : ""}`);
        return Response.json({ ok: true });
      }

      // The view-only terminal page + its vendored xterm.js (V5 Phase 1). All static; the RPCs/WS
      // they call are authed. The token lives in sessionStorage, never these URLs.
      if (request.method === "GET" && url.pathname === "/app/chat") {
        // V6 PRIMARY mobile surface: the Claude session as a native conversation (the terminal at
        // /app/term is the one-tap fallback). Same scoped tokens; renders from the typed RPC data.
        return new Response(CONVERSATION_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
      }
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
      if (request.method === "GET" && url.pathname === "/app/addon-fit.js") {
        return ADDON_FIT_JS
          ? new Response(ADDON_FIT_JS, { headers: { "content-type": "text/javascript; charset=utf-8" } })
          : new Response("addon-fit.js not vendored", { status: 503 });
      }

      // Pairing redemption: an unpaired client exchanges a short code (which IS the
      // credential — single-use + expiring) for a scoped token. No bearer required here, so it's
      // rate-limited + audited per IP to make the short code un-brute-forceable (V5 Phase 0.3).
      if (request.method === "POST" && url.pathname === "/pair") {
        // Rate-limit key (audit M3): behind Tailscale Serve every phone arrives from 127.0.0.1, so a
        // bare IP collapses to ONE shared bucket. Prefer the Tailscale identity header Serve injects
        // (per-remote-device) so buckets aren't shared; fall back to the IP. `loopback` marks the
        // shared/undistinguished case so we know not to clear it on success.
        const tsId = request.headers.get("tailscale-user-login") || request.headers.get("tailscale-user-name");
        const ip = srv.requestIP?.(request)?.address;
        const key = tsId || ip || "loopback";
        const shared = !tsId && (!ip || ip === "127.0.0.1" || ip === "::1"); // can't distinguish callers
        // The per-key limiter is the first line; pairingLocked() is the IP-INDEPENDENT backstop that
        // still holds when the key is the shared loopback bucket.
        if (!pairLimiter.hit(key) || pairing.pairingLocked()) {
          console.error(`[glaudecode] /pair rate-limited (${key})`);
          return Response.json({ error: "too many attempts — slow down" }, { status: 429 });
        }
        const body = await request.json().catch(() => null);
        const tok = pairing.redeem(String(body?.code ?? "").trim().toUpperCase(), String(body?.name ?? "device"));
        if (!tok) {
          console.error(`[glaudecode] /pair failed redemption (${key})`);
          return Response.json({ error: "invalid or expired pairing code" }, { status: 401 });
        }
        // Clear the counter on a legit pair so the user isn't locked out — but NEVER for a shared
        // loopback bucket, where one success would reset the limit for every caller (audit M3).
        if (!shared) pairLimiter.reset(key);
        eventLog.record({ kind: "pair", level: "info", msg: "device paired", data: { scope: tok.scope, deviceId: String(tok.deviceId).slice(0, 8) } });
        return Response.json(tok);
      }

      // File upload from a paired phone (V6): a TRUSTED (terminal-scope) device POSTs a document/photo
      // and the engine writes it under <uploadDir>/.glaudecode-uploads/ — a SERVER-chosen dir the
      // client can't influence — then returns the absolute path so the composer can @-reference it to
      // Claude. Terminal scope only (it writes to disk, an RCE-adjacent capability); size-capped; the
      // x-filename header is reduced to a safe basename (no traversal); audited (deviceId + byte COUNT
      // + saved name, never the bytes). The file bytes are the raw request body.
      if (request.method === "POST" && url.pathname === "/upload") {
        const auth = request.headers.get("authorization") || "";
        const tok = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        const v = pairing.verify(tok);
        if (!v.ok) return Response.json({ error: "unauthorized" }, { status: 401 });
        if (v.scope !== "terminal") return Response.json({ error: "terminal scope required" }, { status: 403 });
        const cap = opts.maxUploadBytes ?? MAX_UPLOAD_BYTES;
        const declared = Number(request.headers.get("content-length") || 0);
        if (declared > cap) return Response.json({ error: "file too large" }, { status: 413 });
        const bytes = new Uint8Array(await request.arrayBuffer().catch(() => new ArrayBuffer(0)));
        if (bytes.length === 0) return Response.json({ error: "empty upload" }, { status: 400 });
        if (bytes.length > cap) return Response.json({ error: "file too large" }, { status: 413 });
        let rawName = "upload";
        try {
          rawName = decodeURIComponent(request.headers.get("x-filename") || "upload");
        } catch {
          /* malformed header → keep the default name */
        }
        const dir = join(opts.uploadDir ?? process.cwd(), UPLOAD_SUBDIR);
        try {
          mkdirSync(dir, { recursive: true });
          const gi = join(dir, ".gitignore");
          if (!existsSync(gi)) writeFileSync(gi, "*\n"); // keep uploads out of git by default
          const name = uniqueUploadName(safeUploadName(rawName), (n) => existsSync(join(dir, n)));
          const dest = join(dir, name);
          writeFileSync(dest, bytes);
          audit.record({ type: "upload", deviceId: v.deviceId, bytes: bytes.length, name });
          return Response.json({ path: dest, name });
        } catch (e) {
          console.error("[glaudecode] /upload failed: " + String((e as Error)?.message ?? e));
          return Response.json({ error: "could not save file" }, { status: 500 });
        }
      }

      // Rust-core pane bridge (V5 Phase 1): the Rust core tees pane PTY bytes here. ENGINE-BEARER
      // only (enforced in websocket.message), so a paired phone can never reach the PTY ingress —
      // the auth boundary, not the bind, is what protects it.
      if (url.pathname === "/pane-bridge") {
        if (srv.upgrade(request, { data: { kind: "bridge", authed: false } })) return undefined;
        return new Response("expected websocket", { status: 426 });
      }
      // Rust-core input sink (V5 Phase 2): the engine pushes phone keystrokes to the Rust core over
      // this socket. ENGINE-BEARER only — a paired phone can never connect here to inject input; it
      // can only send INPUT on /term-ws, which the engine gates (terminal scope + armed pane) before
      // relaying onto this trusted channel.
      if (url.pathname === "/pane-input-bridge") {
        if (srv.upgrade(request, { data: { kind: "inbridge", authed: false } })) return undefined;
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

  // Push live approvals to cockpit sockets (the EventBus push stream will replace this), and sweep
  // mirror sockets whose token no longer verifies (revoked/expired) — so de-authorizing a device
  // tears down its LIVE session within ~2s, not only on the next frame (Phase 2 review #1).
  const broadcast = setInterval(() => {
    // Self-heal any mirror sub parked `lagging` whose recovery ACK never arrived (deterministic
    // recovery that doesn't depend on the phone sending a final ACK) — see PaneHub.resyncStalled.
    paneHub.resyncStalled();
    for (const ws of termSockets) {
      const tok = ws.data?.token ?? "";
      const v = pairing.verify(tok);
      if (!v.ok) {
        audit.record({ type: "disconnect", deviceId: ws.data?.deviceId, reason: "revoked-or-expired" });
        try {
          ws.close(4003, "token revoked or expired");
        } catch {
          /* already closed */
        }
      } else if (v.scope === "terminal") {
        pairing.refresh(tok); // a live terminal session rolls its short-TTL token forward (R8)
      }
    }
    if (sockets.size === 0) return;
    const at = new Date().toISOString();
    for (const ws of sockets) {
      // The /ws approvals stream is the MORE sensitive feed (it carries the tool, the full input —
      // the exact Bash command + paths — and the sessionId), yet it was only verified at first-message
      // auth. Re-verify here exactly like termSockets so a revoked/expired device's LIVE approvals
      // feed is cut within ~2s, not left streaming until it happens to disconnect (audit H3).
      const tok = ws.data?.token ?? "";
      const v = pairing.verify(tok);
      if (!v.ok) {
        audit.record({ type: "disconnect", deviceId: ws.data?.deviceId, reason: "revoked-or-expired" });
        try {
          ws.close(4003, "token revoked or expired");
        } catch {
          /* already closed */
        }
        continue; // never push live tool commands to a de-authorized device
      }
      // Scope the payload per-socket: a view device gets the redacted list, steer+ the full one (M1).
      ws.send(frameEvent("approvals", approvalsForScope(v.scope), at));
    }
  }, 2000);
  (broadcast as any)?.unref?.();

  eventLog.record({ kind: "engine", level: "info", msg: "engine started", data: { port: server.port } });

  return {
    port: server.port,
    token,
    approvals,
    pairing,
    remote,
    eventLog,
    stop: () => {
      clearInterval(broadcast);
      approvals.clear();
      remote.disable();
      server.stop(true);
    },
  };
}
