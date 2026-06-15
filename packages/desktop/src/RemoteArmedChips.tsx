import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { remoteStatus, listArmed, disarmAllPanes } from "./engine";

// Persistent GLOBAL "remote ON / N panes armed" indicator + an always-reachable kill switch
// (audit M14). Rendered as a fixed overlay at the App root so it survives even zen mode — where the
// bottom StatusBar is hidden — because the UI must NEVER be able to obscure the fact that the machine
// is currently live to remote code execution. Self-hides when nothing is remote or armed.
export function RemoteArmedChips() {
  const [remoteOn, setRemoteOn] = useState(false);
  const [armed, setArmed] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Live armed count: hydrate from the AUTHORITATIVE Rust core and follow its armed-changed event
  // (audit H2), so this can never desync from what can actually accept phone keystrokes.
  useEffect(() => {
    let alive = true;
    const hydrate = () => void listArmed().then((ids) => alive && setArmed(ids)).catch(() => {});
    hydrate();
    const onFocus = () => hydrate();
    window.addEventListener("focus", onFocus);
    const unlistenP = listen<string[]>("armed-changed", (e) => alive && setArmed(e.payload));
    return () => {
      alive = false;
      window.removeEventListener("focus", onFocus);
      void unlistenP.then((un) => un());
    };
  }, []);

  // Remote listener status: poll it (the toggle lives in PairingModal; there's no event for it yet).
  useEffect(() => {
    let alive = true;
    const poll = () => void remoteStatus().then((r) => alive && setRemoteOn(r.enabled)).catch(() => {});
    poll();
    const id = setInterval(poll, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const kill = async () => {
    try {
      await disarmAllPanes();
      setArmed([]);
      setError(null);
    } catch {
      // Surface failure rather than faking success — panes may still be armed in Rust (audit M4).
      setError("Disarm failed — panes may still accept phone input");
    }
  };

  if (!remoteOn && armed.length === 0 && !error) return null;

  return (
    <div className="remote-armed-chips" role="status" aria-live="polite">
      {remoteOn && (
        <span className="rac-chip rac-remote" title="Remote cockpit listener is ON — a paired device can reach this machine">
          REMOTE
        </span>
      )}
      {armed.length > 0 && (
        <>
          <span
            className="rac-chip rac-armed"
            title={`${armed.length} pane(s) accept phone keystrokes — remote code execution is possible`}
          >
            ARMED ×{armed.length}
          </span>
          <button
            className="rac-kill"
            aria-label="Disarm all panes — immediately stop all phone input"
            title="Disarm all panes — immediately stop all phone input"
            onClick={() => void kill()}
          >
            ⛔ Disarm all
          </button>
        </>
      )}
      {error && (
        <span className="rac-chip rac-error" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}
