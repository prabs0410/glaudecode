// Localhost-only HTTP server exposing the engine RPC. Binds 127.0.0.1 on an
// ephemeral port with a per-launch bearer token. The desktop app spawns this as a
// sidecar and reads {port, token} from the process's first stdout line; the same
// server is the basis for the future web/mobile cockpit (ADR 0004 RemoteServer).
//
// NOTE: not compiled with `bun build --compile` — that breaks the Agent SDK's CLI
// resolution (SDK #150). Ship as a Bun script run by a bundled Bun runtime.

import { ClaudeCodeAdapter } from "./adapter";
import { createRpcHandler } from "./rpc";
import { ApprovalQueue } from "./approvalQueue";
import { PairingService } from "./pairing";

export interface EngineServer {
  port: number;
  token: string;
  approvals: ApprovalQueue;
  pairing: PairingService;
  stop: () => void;
}

export interface StartOptions {
  /** Bearer token clients must present. Generated if omitted. */
  token?: string;
  /** Port to bind; 0 = ephemeral (default). */
  port?: number;
}

export function startEngineServer(opts: StartOptions = {}): EngineServer {
  const token = opts.token ?? crypto.randomUUID();
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
  // only known after Bun.serve binds. The handler closes over this object, so filling
  // in `port` below is visible to later requests.
  const endpoint = { port: 0, token };
  const handler = createRpcHandler(adapter, token, { approvals, endpoint, pairing });

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: opts.port ?? 0,
    fetch: handler,
  });

  // Always a numeric TCP port here (we never bind a unix socket), but Bun types
  // it as number | undefined — guard rather than assert.
  if (server.port == null) {
    server.stop(true);
    throw new Error("engine server failed to bind a TCP port");
  }
  endpoint.port = server.port;

  return {
    port: server.port,
    token,
    approvals,
    pairing,
    stop: () => {
      approvals.clear();
      server.stop(true);
    },
  };
}
