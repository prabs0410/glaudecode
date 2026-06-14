// PaneHub (V5 Phase 1) — the engine-side relay for the view-only terminal mirror. The Rust core
// tees each pane's PTY bytes here over the pane-bridge; the hub keeps a bounded per-pane ring
// buffer (so a (re)attaching phone gets the current screen, not a blank pane) and fans frames out
// to cockpit subscribers with ACK-based flow control (xterm.js silently discards past ~50MB and
// WebSocket buffers are unbounded, so we MUST pace the consumer). The LOCAL terminal is never
// affected — that path is the Rust->WebView app.emit, entirely separate from this hub.
//
// Pure + injectable (subscribers are just {send}), so the buffering + flow-control logic is unit-
// tested here with no real sockets. Watermarks default high (> ring) so a fresh full-ring attach is
// never treated as "behind"; flow control only engages on genuine live backlog.

import { encodeOutput, encodeSize } from "./termProtocol";

export interface TermSubscriber {
  send(frame: Uint8Array): void;
  close?(): void;
}

export interface PaneHubOptions {
  /** Bytes of recent output kept per pane for replay-on-attach. */
  ringMax?: number;
  /** Pending (unacked) bytes above which a subscriber is paused (live frames dropped for it). */
  highWater?: number;
  /** Pending at/below which a paused subscriber resyncs (reset + replay) and resumes. */
  lowWater?: number;
}

// ESC c — full terminal reset, sent before a resync replay so the phone's xterm starts clean.
const RESET = new Uint8Array([0x1b, 0x63]);

interface SubState {
  sent: number; // cumulative OUTPUT payload bytes sent to this subscriber
  acked: number; // cumulative bytes the subscriber reports consumed
  lagging: boolean; // true once we've skipped a live frame for it (needs resync on recovery)
}

interface PaneState {
  ring: Uint8Array[];
  ringBytes: number;
  cols: number;
  rows: number;
  subs: Map<TermSubscriber, SubState>;
}

export class PaneHub {
  private readonly panes = new Map<string, PaneState>();
  private readonly ringMax: number;
  private readonly hi: number;
  private readonly lo: number;

  constructor(opts: PaneHubOptions = {}) {
    this.ringMax = opts.ringMax ?? 128 * 1024;
    this.hi = opts.highWater ?? 512 * 1024;
    this.lo = opts.lowWater ?? 64 * 1024;
  }

  private ensure(paneId: string): PaneState {
    let p = this.panes.get(paneId);
    if (!p) {
      p = { ring: [], ringBytes: 0, cols: 80, rows: 24, subs: new Map() };
      this.panes.set(paneId, p);
    }
    return p;
  }

  /** Live bytes from the bridge for a pane: append to the ring, then fan out (flow-controlled). */
  ingest(paneId: string, bytes: Uint8Array): void {
    if (bytes.length === 0) return;
    const p = this.ensure(paneId);
    p.ring.push(bytes);
    p.ringBytes += bytes.length;
    while (p.ringBytes > this.ringMax && p.ring.length > 1) p.ringBytes -= p.ring.shift()!.length;
    const frame = encodeOutput(bytes);
    for (const [sub, st] of p.subs) {
      if (st.sent - st.acked > this.hi) {
        st.lagging = true; // behind — drop live frames for it; it will resync once it catches up
        continue;
      }
      sub.send(frame);
      st.sent += bytes.length;
    }
  }

  /** Update a pane's size and notify subscribers (phone renders at this size; view-only). */
  setSize(paneId: string, cols: number, rows: number): void {
    const p = this.ensure(paneId);
    p.cols = cols;
    p.rows = rows;
    const frame = encodeSize(cols, rows);
    for (const sub of p.subs.keys()) sub.send(frame);
  }

  /** Attach a subscriber: send current size, replay the ring (current screen), then go live. */
  attach(paneId: string, sub: TermSubscriber): () => void {
    const p = this.ensure(paneId);
    const replayed = this.replay(p, sub);
    p.subs.set(sub, { sent: replayed, acked: 0, lagging: false });
    return () => p.subs.delete(sub);
  }

  /** Client ACK of total consumed bytes → advance flow control; resync a recovered laggard. */
  ack(paneId: string, sub: TermSubscriber, totalBytes: number): void {
    const p = this.panes.get(paneId);
    const st = p?.subs.get(sub);
    if (!p || !st) return;
    st.acked = Math.max(st.acked, totalBytes);
    if (st.lagging && st.sent - st.acked <= this.lo) {
      sub.send(encodeOutput(RESET));
      const replayed = this.replay(p, sub);
      st.sent = st.acked + RESET.length + replayed;
      st.lagging = false;
    }
  }

  /** Pane ended on the host → tell subscribers and drop the pane. */
  closePane(paneId: string): void {
    const p = this.panes.get(paneId);
    if (!p) return;
    for (const sub of p.subs.keys()) sub.close?.();
    this.panes.delete(paneId);
  }

  /** Number of live subscribers on a pane (for tests / metrics). */
  subscriberCount(paneId: string): number {
    return this.panes.get(paneId)?.subs.size ?? 0;
  }

  private replay(p: PaneState, sub: TermSubscriber): number {
    sub.send(encodeSize(p.cols, p.rows));
    let n = 0;
    for (const chunk of p.ring) {
      sub.send(encodeOutput(chunk));
      n += chunk.length;
    }
    return n;
  }
}
