// Lifecycle audit log for the remote-input (RCE) channel (V5 Phase 3 / Story 3.3.2). Records WHO did
// WHAT WHEN at a COARSE grain for incident review — crucially, an "input" event carries a paneId +
// a BYTE COUNT only, never the keystroke bytes (so the log never persists commands/secrets). Held
// in memory + bounded (no token/secret at rest), like the rest of the engine; `now` is injected so
// it's deterministic under test.

export type AuditEventType =
  | "terminal-auth"
  | "arm"
  | "disarm"
  | "input"
  | "input-dropped"
  | "disconnect";

export interface AuditEvent {
  type: AuditEventType;
  at: string; // ISO timestamp
  deviceId?: string;
  paneId?: string;
  /** For "input": a COUNT of bytes relayed — NEVER the payload. */
  bytes?: number;
  /** For "disconnect": why (revoked / expired / link-down). */
  reason?: string;
}

export class AuditLog {
  private readonly events: AuditEvent[] = [];
  constructor(
    private readonly now: () => number,
    private readonly max = 1000,
  ) {}

  record(e: Omit<AuditEvent, "at">): void {
    this.events.push({ ...e, at: new Date(this.now()).toISOString() });
    if (this.events.length > this.max) this.events.shift(); // bounded — oldest drops
  }

  list(): AuditEvent[] {
    return [...this.events];
  }
}
