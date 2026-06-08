#!/usr/bin/env bun
// Engine sidecar entrypoint. Starts the localhost RPC server and prints a single
// JSON line `{"port":N,"token":"..."}` to stdout so the spawning process (the Tauri
// core) can connect. Stays alive until killed.

import { startEngineServer } from "../src/server";

const server = startEngineServer({
  token: process.env.GLAUDE_ENGINE_TOKEN,
  port: process.env.GLAUDE_ENGINE_PORT ? Number(process.env.GLAUDE_ENGINE_PORT) : 0,
});

// Handshake line — first line of stdout, newline-terminated.
process.stdout.write(JSON.stringify({ port: server.port, token: server.token }) + "\n");

const shutdown = () => {
  server.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
