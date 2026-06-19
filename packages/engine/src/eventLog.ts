// Observability EventLog (V6.5) — the engine is the hub: a single bounded, in-memory, PRIVACY-SAFE
// stream of what's happening across the system (RPC calls + timings, WebSocket lifecycle, pairing,
// bridge connects, uploads, engine lifecycle, and errors forwarded from the phone). It generalises
// the AuditLog principle: events carry METADATA ONLY — method names, scopes, status, durations,
// counts, codes, device ids — NEVER payloads, keystrokes, file contents, prompts, or tokens. Held in
// memory + bounded (nothing at rest); `now` is injected so it's deterministic under test. The
// diagnostics() RPC reads this + assembles a health snapshot; the Mac panel + phone Debug tab render it.

export type EventKind =
  | "rpc" // an RPC call: { method, scope, ms, ok } (+ err on failure)
  | "ws" // a WebSocket lifecycle event: { socket, event: open|auth|close, code? }
  | "pair" // a device paired / a pair attempt
  | "revoke" // a device revoked
  | "bridge" // the Rust<->engine bridge connected/disconnected/respawned
  | "upload" // a file upload (byte count + name, never bytes)
  | "engine" // engine lifecycle (start, remote enable/disable, errors)
  | "phone" // an error/event forwarded from a phone surface (no payload)
  | "audit"; // mirrored from the RCE audit channel

export type EventLevel = "info" | "warn" | "error";

export interface LogEvent {
  seq: number; // monotonic, for cheap incremental polling (sinceSeq)
  at: string; // ISO timestamp
  kind: EventKind;
  level: EventLevel;
  msg: string; // a short human label (e.g. "rpc getSessionMessages", "ws /term-ws auth")
  /** Metadata ONLY — never a payload/secret. Numbers/strings/bools for a structured view. */
  data?: Record<string, string | number | boolean>;
}

export interface EventQuery {
  limit?: number;
  kinds?: EventKind[];
  level?: EventLevel; // minimum level (warn → warn+error)
  sinceSeq?: number; // only events with seq > sinceSeq (incremental polling)
}

const LEVEL_RANK: Record<EventLevel, number> = { info: 0, warn: 1, error: 2 };

export class EventLog {
  private events: LogEvent[] = [];
  private seq = 0;
  constructor(
    private readonly now: () => number,
    private readonly max = 800,
  ) {}

  /** Record an event. Returns the stored event (with its seq + timestamp). */
  record(e: Omit<LogEvent, "seq" | "at">): LogEvent {
    const ev: LogEvent = { ...e, seq: ++this.seq, at: new Date(this.now()).toISOString() };
    this.events.push(ev);
    if (this.events.length > this.max) this.events.shift(); // bounded — oldest drops
    return ev;
  }

  /** Newest-last list, filtered. `limit` keeps the most RECENT N after filtering. */
  list(q: EventQuery = {}): LogEvent[] {
    let out = this.events;
    if (q.sinceSeq != null) out = out.filter((e) => e.seq > q.sinceSeq!);
    if (q.kinds && q.kinds.length) out = out.filter((e) => q.kinds!.includes(e.kind));
    if (q.level) out = out.filter((e) => LEVEL_RANK[e.level] >= LEVEL_RANK[q.level!]);
    if (q.limit != null && out.length > q.limit) out = out.slice(out.length - q.limit);
    return [...out];
  }

  /** The most recent error event, or null — drives the health snapshot's "last error". */
  lastError(): LogEvent | null {
    for (let i = this.events.length - 1; i >= 0; i--) if (this.events[i].level === "error") return this.events[i];
    return null;
  }

  /** Event counts by kind (for the health/overview row). */
  countsByKind(): Record<string, number> {
    const c: Record<string, number> = {};
    for (const e of this.events) c[e.kind] = (c[e.kind] ?? 0) + 1;
    return c;
  }

  /** Per-method RPC latency + error-rate summary (lightweight APM) computed from the rpc events. */
  rpcMetrics(): Array<{ method: string; calls: number; errors: number; p50: number; p95: number; maxMs: number }> {
    const byMethod = new Map<string, number[]>();
    const errs = new Map<string, number>();
    for (const e of this.events) {
      if (e.kind !== "rpc" || !e.data) continue;
      const method = String(e.data.method ?? "?");
      const ms = typeof e.data.ms === "number" ? e.data.ms : 0;
      if (!byMethod.has(method)) byMethod.set(method, []);
      byMethod.get(method)!.push(ms);
      if (e.data.ok === false) errs.set(method, (errs.get(method) ?? 0) + 1);
    }
    const pct = (arr: number[], p: number) => {
      if (!arr.length) return 0;
      const s = [...arr].sort((a, b) => a - b);
      return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
    };
    return [...byMethod.entries()]
      .map(([method, ms]) => ({ method, calls: ms.length, errors: errs.get(method) ?? 0, p50: pct(ms, 50), p95: pct(ms, 95), maxMs: Math.max(...ms) }))
      .sort((a, b) => b.calls - a.calls);
  }

  size(): number {
    return this.events.length;
  }
}
