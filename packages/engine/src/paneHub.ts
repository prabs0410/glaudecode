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
  stalledTicks: number; // consecutive sweeps spent lagging without an ACK-driven recovery
}

interface PaneState {
  ring: Uint8Array[];
  ringBytes: number;
  cols: number;
  rows: number;
  title: string;
  /** Remote input allowed for this pane? Default OFF (V5 Phase 2 — Rust core is authoritative;
   *  this is the engine's mirrored copy, used to gate input early + show armed state on the phone). */
  armed: boolean;
  subs: Map<TermSubscriber, SubState>;
}

/** A pane the cockpit can attach to (for the phone's pane picker — listPanes RPC). */
export interface PaneInfo {
  paneId: string;
  title: string;
  cols: number;
  rows: number;
  /** Whether the desktop has armed this pane for remote (phone) input (V5 Phase 2). */
  armed: boolean;
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
      p = { ring: [], ringBytes: 0, cols: 80, rows: 24, title: "", armed: false, subs: new Map() };
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
        // behind — drop live frames for it; it resyncs once it catches up (ack) or after a stall
        // (resyncStalled). Reset the stall counter on the lagging transition so the slow-path timer
        // measures THIS stall, not a previous one.
        if (!st.lagging) {
          st.lagging = true;
          st.stalledTicks = 0;
        }
        continue;
      }
      sub.send(frame);
      st.sent += bytes.length;
    }
  }

  /** Update a pane's size and notify subscribers (phone renders at this size; view-only). A SIZE
   *  resizes the phone's xterm (reflow/clear), so we MUST NOT send it to a lagging sub whose live
   *  OUTPUT is currently suppressed — it would wipe the screen with no repaint to follow. A lagging
   *  sub gets the current size at resync instead (replay leads with a SIZE frame). */
  setSize(paneId: string, cols: number, rows: number): void {
    const p = this.ensure(paneId);
    p.cols = cols;
    p.rows = rows;
    const frame = encodeSize(cols, rows);
    for (const [sub, st] of p.subs) if (!st.lagging) sub.send(frame);
  }

  /** Attach a subscriber to a REAL pane: send current size, replay the ring, go live. Returns the
   *  detach fn, or null if the paneId was never announced by the Rust bridge — a phone must not be
   *  able to conjure a phantom pane (which would pollute listPanes forever); `ensure()` stays for the
   *  bridge-driven paths (ingest/setSize/setMeta/setArmed) only (audit M12). */
  attach(paneId: string, sub: TermSubscriber): (() => void) | null {
    const p = this.panes.get(paneId);
    if (!p) return null; // phantom paneId — caller closes the socket (4002)
    const replayed = this.replay(p, sub);
    p.subs.set(sub, { sent: replayed, acked: 0, lagging: false, stalledTicks: 0 });
    return () => p.subs.delete(sub);
  }

  /** Client ACK of total consumed bytes → advance flow control; resync a recovered laggard. */
  ack(paneId: string, sub: TermSubscriber, totalBytes: number): void {
    const p = this.panes.get(paneId);
    const st = p?.subs.get(sub);
    if (!p || !st) return;
    st.acked = Math.max(st.acked, totalBytes);
    if (st.lagging && st.sent - st.acked <= this.lo) this.resync(p, sub, st);
  }

  /** Server-driven recovery (no client-ACK gate). The fast path (ack) resyncs a sub the instant it
   *  drains back under the low watermark. But a sub can stay parked `lagging` FOREVER when bytes the
   *  engine counted as `sent` were dropped before the phone got them (e.g. at the WebSocket
   *  backpressure cap) — then its ACK can never reach `<= lo` and ack() never fires. Called from the
   *  engine's periodic sweep: a sub still stuck after ~2 sweeps is force-repainted from the ring and
   *  resumed, WITHOUT waiting on a client ACK. Bounded: at most one ring (≤ ringMax) per repaint, and
   *  re-armed only when the next live frame re-lags it — so a pathologically slow link can't pile up. */
  resyncStalled(): void {
    for (const p of this.panes.values()) {
      for (const [sub, st] of p.subs) {
        if (st.lagging && ++st.stalledTicks >= 2) this.resync(p, sub, st);
      }
    }
  }

  /** Reset the phone's xterm and replay the current ring, then resume live delivery for `st`. Shared
   *  by the ACK-driven (ack) and timer-driven (resyncStalled) recovery paths so the byte accounting
   *  stays identical on both — the phone's `received` counter must track `st.sent` exactly. */
  private resync(p: PaneState, sub: TermSubscriber, st: SubState): void {
    sub.send(encodeOutput(RESET));
    const replayed = this.replay(p, sub);
    st.sent = st.acked + RESET.length + replayed;
    st.lagging = false;
    st.stalledTicks = 0;
  }

  /** Pane ended on the host → tell subscribers and drop the pane. */
  closePane(paneId: string): void {
    const p = this.panes.get(paneId);
    if (!p) return;
    for (const sub of p.subs.keys()) sub.close?.();
    this.panes.delete(paneId);
  }

  /** Human label for a pane (from the bridge META frame) — shown in the cockpit pane picker. */
  setMeta(paneId: string, title: string): void {
    this.ensure(paneId).title = title;
  }

  /** Mirror a pane's arming (from the bridge ARM frame). The Rust core is authoritative — this
   *  copy lets the engine reject input to an unarmed pane early + show armed state on the phone. */
  setArmed(paneId: string, armed: boolean): void {
    this.ensure(paneId).armed = armed;
  }

  /** Engine-side gate: may a phone's keystrokes be forwarded to this pane? True only if the pane
   *  exists AND is armed. The Rust core re-checks arming authoritatively before writing the PTY. */
  canInput(paneId: string): boolean {
    return this.panes.get(paneId)?.armed ?? false;
  }

  /** Panes the cockpit can attach to (for the listPanes RPC). */
  list(): PaneInfo[] {
    return [...this.panes.entries()].map(([paneId, p]) => ({
      paneId,
      title: p.title,
      cols: p.cols,
      rows: p.rows,
      armed: p.armed,
    }));
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
