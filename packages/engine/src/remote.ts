// Remote event framing (Epic G §3.1). The cockpit subscribes over a WebSocket; the engine
// pushes small JSON frames (live approvals, heartbeats) so the client updates without
// polling. Framing is pure + unit-tested; the WS plumbing lives in server.ts.

export interface RemoteFrame {
  type: string;
  payload?: unknown;
  /** ISO timestamp; caller-supplied so framing stays pure/deterministic in tests. */
  at?: string;
}

export function frameEvent(type: string, payload?: unknown, at?: string): string {
  return JSON.stringify({ type, payload, at });
}

export function parseFrame(raw: string): RemoteFrame | null {
  try {
    const v = JSON.parse(raw);
    if (v && typeof v.type === "string") return v as RemoteFrame;
    return null;
  } catch {
    return null;
  }
}
