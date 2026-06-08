#!/usr/bin/env bun
// PreToolUse hook runner (Epic C §3.2). Claude Code runs this before each tool call,
// passing the event JSON on stdin. We forward the call to the engine's /approval
// endpoint and emit the decision in Claude's hook format. If the engine is unreachable
// we fail SAFE: read-only tools allow (fail-open), everything else denies (fail-closed)
// — the locked V2 approval decision.
//
// Usage: bun approval-hook.ts <endpoint-file>
//   <endpoint-file> holds {"port":N,"token":"..."} written by the engine on install.

import { readFile } from "node:fs/promises";
import { classifyTool } from "../src/approval";

type Decision = "allow" | "deny" | "ask";

function emit(decision: Decision, reason: string): never {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    }) + "\n",
  );
  process.exit(0);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const payload = JSON.parse((await readStdin()) || "{}");
const tool: string = payload.tool_name ?? payload.toolName ?? "";
const input = payload.tool_input ?? payload.toolInput ?? {};
const sessionId: string = payload.session_id ?? payload.sessionId ?? "";
const repoDir: string | undefined = payload.cwd ?? undefined;

// Local fail-safe used when the engine can't be reached.
const failSafe = () => {
  const c = classifyTool(tool, input, { repoDir });
  if (c.decision === "auto-allow") emit("allow", "engine unreachable — read-only allowed");
  emit("deny", "engine unreachable — denied (fail-closed)");
};

try {
  const endpointFile = process.argv[2];
  if (!endpointFile) failSafe();
  const { port, token } = JSON.parse(await readFile(endpointFile!, "utf8"));

  const res = await fetch(`http://127.0.0.1:${port}/approval`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ sessionId, tool, input, repoDir }),
  });
  if (!res.ok) failSafe();
  const body = (await res.json()) as { decision?: Decision; reason?: string };
  emit(body.decision ?? "deny", body.reason ?? "no decision");
} catch {
  failSafe();
}
