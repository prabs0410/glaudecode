// Sliding-window rate limiter (pure, injectable clock) for unauthenticated endpoints like /pair
// (V5 Phase 0.3). Records each attempt per key (e.g. client IP) and denies once ANY configured
// window is exceeded. Multiple windows compose (e.g. 2/min AND 12/hr) — code-server's baseline.
// Denied attempts are NOT recorded, so a hammering client can't extend its own lockout, and a
// legitimate client recovers as soon as the oldest recorded attempt slides out of the window.

export interface RateWindow {
  windowMs: number;
  max: number;
}

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly maxWindowMs: number;

  constructor(
    private readonly now: () => number,
    private readonly windows: RateWindow[],
  ) {
    this.maxWindowMs = windows.reduce((m, w) => Math.max(m, w.windowMs), 0);
  }

  /** Record an attempt for `key`; return true if allowed, false if it exceeds any window. */
  hit(key: string): boolean {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((ts) => t - ts < this.maxWindowMs);
    for (const w of this.windows) {
      const inWindow = recent.reduce((n, ts) => (t - ts < w.windowMs ? n + 1 : n), 0);
      if (inWindow >= w.max) {
        this.hits.set(key, recent); // keep pruned history; do NOT record the denied attempt
        return false;
      }
    }
    recent.push(t);
    this.hits.set(key, recent);
    return true;
  }

  /** Clear a key's history (e.g. after a successful pairing, so a legit user isn't locked out). */
  reset(key: string): void {
    this.hits.delete(key);
  }
}
