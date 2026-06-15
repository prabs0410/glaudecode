import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

// Surfaces engine-sidecar lifecycle events from the Rust supervisor (audit M6). A post-handshake
// engine crash used to be SILENT — remote/RPC just stopped working with no signal. The supervisor now
// emits: engine-exit (crashed, retrying), engine-respawned (recovered), engine-down (gave up after
// bounded retries — restart needed), engine-start-failed (never came up). We show a banner so the
// user knows the machine isn't quietly half-broken.
export function EngineStatusBanner() {
  const [msg, setMsg] = useState<{ text: string; level: "warn" | "error" } | null>(null);
  useEffect(() => {
    const subs = [
      listen("engine-exit", () => setMsg({ text: "Engine stopped — reconnecting…", level: "warn" })),
      listen("engine-respawned", () => setMsg(null)),
      listen<string>("engine-down", (e) =>
        setMsg({ text: String(e.payload || "Engine unavailable — restart GlaudeCode."), level: "error" })),
      listen<string>("engine-start-failed", (e) =>
        setMsg({ text: "Engine failed to start: " + String(e.payload), level: "error" })),
    ];
    return () => subs.forEach((p) => void p.then((un) => un()));
  }, []);
  if (!msg) return null;
  return (
    <div className={`engine-banner ${msg.level}`} role="status" aria-live="polite">
      {msg.text}
    </div>
  );
}
