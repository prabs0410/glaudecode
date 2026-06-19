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
  | "upload"
  | "disconnect";

export interface AuditEvent {
  type: AuditEventType;
  at: string; // ISO timestamp
  deviceId?: string;
  paneId?: string;
  /** For "input"/"upload": a COUNT of bytes — NEVER the payload/contents. */
  bytes?: number;
  /** For "upload": the saved filename (the user's own chosen name — metadata, never the bytes). */
  name?: string;
  /** For "disconnect": why (revoked / expired / link-down). */
  reason?: string;
}

export class AuditLog {
  private readonly events: AuditEvent[] = [];
  constructor(
    private readonly now: () => number,
    private readonly max = 1000,
    /** Optional mirror — every audited event is also forwarded here (OBS-2: into the EventLog
     *  stream) so the RCE-channel activity shows up in diagnostics without touching call sites. */
    private readonly mirror?: (e: AuditEvent) => void,
  ) {}

  record(e: Omit<AuditEvent, "at">): void {
    const ev: AuditEvent = { ...e, at: new Date(this.now()).toISOString() };
    this.events.push(ev);
    if (this.events.length > this.max) this.events.shift(); // bounded — oldest drops
    this.mirror?.(ev);
  }

  list(): AuditEvent[] {
    return [...this.events];
  }
}
