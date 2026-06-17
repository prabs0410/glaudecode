// Resize authority (V6 Phase 1.7). A phone may RESIZE the shared Mac PTY only when no desktop viewer
// is present — otherwise the phone fitting the pane to ~45 cols would reshape the desk's terminal
// under the user. "Desktop present" = the desktop WebView reported itself active (focused/visible)
// within a grace window. It heartbeats while focused, so the ABSENCE of heartbeats (lid closed, app
// backgrounded, away from the desk) means no viewer and the phone may take size.
//
// We use desktop-window focus as the presence signal rather than raw lid/display state: it's the
// robust, direct answer to "is someone using the desk right now?" (and the founder's built-in display
// is dead — they drive an external monitor — so lid state wouldn't even mean what it usually means).
//
// Pure + injectable (the clock is passed in) so the authority logic is unit-tested with no real time.

export const DESKTOP_PRESENCE_GRACE_MS = 30_000;

/** May a phone drive the PTY size? True once the last desktop-active report is older than the grace. */
export function mayResize(lastDesktopActiveMs: number, nowMs: number, graceMs = DESKTOP_PRESENCE_GRACE_MS): boolean {
  return nowMs - lastDesktopActiveMs >= graceMs;
}

export class DesktopPresence {
  private lastActiveMs: number;
  constructor(
    private readonly now: () => number,
    private readonly graceMs: number = DESKTOP_PRESENCE_GRACE_MS,
  ) {
    // Assume a desktop viewer is present at startup (the app just launched on the Mac) — fail safe:
    // the phone can't reshape the pane until we've actually seen the desk go quiet for the full grace.
    this.lastActiveMs = now();
  }
  /** The desktop WebView reports it's focused/visible (called on focus + a periodic heartbeat). */
  heartbeat(): void {
    this.lastActiveMs = this.now();
  }
  /** May a phone drive the shared PTY size right now? */
  phoneMayResize(): boolean {
    return mayResize(this.lastActiveMs, this.now(), this.graceMs);
  }
  /** Last time the desktop reported active (for tests / diagnostics). */
  lastActive(): number {
    return this.lastActiveMs;
  }
}
