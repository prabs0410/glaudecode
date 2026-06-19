import { useEffect, useRef, useState } from "react";
import { diagnostics, auditLog, type Diagnostics, type AuditEvent } from "./engine";

// Mac diagnostics panel (OBS-4): renders the engine's observability stream — a live event feed
// (filterable), per-method APM metrics, and a health snapshot. LOCAL-only (desktop bearer); the
// engine never exposes this full stream to a paired remote device. Metadata only — no payloads.

const KINDS = ["rpc", "ws", "pair", "revoke", "bridge", "upload", "engine", "phone", "audit"] as const;

export function DiagnosticsPanel({ onClose }: { onClose: () => void }) {
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"events" | "metrics" | "health" | "audit">("events");
  const [audit, setAudit] = useState<AuditEvent[] | null>(null);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [kind, setKind] = useState<string>("");
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const poll = () => {
      if (document.hidden) return; // don't poll a hidden window
      diagnostics({ limit: 300, level: onlyErrors ? "warn" : undefined, kinds: kind ? [kind] : undefined })
        .then((d) => {
          setDiag(d);
          setErr(null);
        })
        .catch((e) => setErr(String(e?.message ?? e)));
    };
    poll();
    timer.current = window.setInterval(poll, 2000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [onlyErrors, kind]);

  // The RCE audit trail is a separate LOCAL RPC; pull it only while its tab is open.
  useEffect(() => {
    if (tab !== "audit") return;
    let alive = true;
    const pull = () => { if (!document.hidden) auditLog().then((a) => alive && setAudit(a)).catch(() => {}); };
    pull();
    const id = window.setInterval(pull, 3000);
    return () => { alive = false; clearInterval(id); };
  }, [tab]);

  const h = diag?.health;
  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="diag-modal" onClick={(e) => e.stopPropagation()}>
        <div className="keys-head">
          <span>Diagnostics</span>
          <div style={{ display: "flex", gap: 6 }}>
            <button className={`act mini${tab === "events" ? " on" : ""}`} onClick={() => setTab("events")}>Events</button>
            <button className={`act mini${tab === "metrics" ? " on" : ""}`} onClick={() => setTab("metrics")}>APM</button>
            <button className={`act mini${tab === "health" ? " on" : ""}`} onClick={() => setTab("health")}>Health</button>
            <button className={`act mini${tab === "audit" ? " on" : ""}`} onClick={() => setTab("audit")}>Audit</button>
          </div>
        </div>
        {err && <div className="dock-error">diagnostics unavailable: {err}</div>}
        {h && (
          <div className="diag-health">
            <span className={h.engineUp ? "ok" : "bad"}>● engine</span>
            <span className={h.bridgeConnected ? "ok" : "bad"}>● bridge</span>
            <span>{h.panes} panes · {h.armedPanes} armed</span>
            <span>{h.devices} device{h.devices === 1 ? "" : "s"}</span>
            <span>{h.remoteEnabled ? "remote ON" : "local"}</span>
            <span>up {h.uptimeMs != null ? Math.round(h.uptimeMs / 1000) + "s" : "?"}</span>
            {h.lastError && <span className="bad" title={h.lastError.msg}>last: {h.lastError.msg.slice(0, 60)}</span>}
          </div>
        )}
        {tab === "events" && (
          <>
            <div className="diag-filters">
              <label>
                <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} /> errors + warnings only
              </label>
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="">all kinds</option>
                {KINDS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </div>
            <div className="diag-events">
              {(diag?.events ?? [])
                .slice()
                .reverse()
                .map((e) => (
                  <div key={e.seq} className={`diag-row lvl-${e.level}`}>
                    <span className="diag-kind">{e.kind}</span>
                    <span className="diag-msg">{e.msg}</span>
                    {typeof e.data?.ms === "number" && <span className="diag-ms">{e.data.ms}ms</span>}
                  </div>
                ))}
              {diag && diag.events.length === 0 && <div className="diag-empty">No events match the filter.</div>}
            </div>
          </>
        )}
        {tab === "metrics" && (
          <div className="diag-events">
            <div className="diag-row diag-mhead">
              <span>method</span><span>calls</span><span>err</span><span>p50</span><span>p95</span><span>max</span>
            </div>
            {(diag?.metrics ?? []).map((m) => (
              <div key={m.method} className="diag-row diag-mrow">
                <span>{m.method}</span>
                <span>{m.calls}</span>
                <span className={m.errors ? "bad" : ""}>{m.errors}</span>
                <span>{m.p50}ms</span>
                <span>{m.p95}ms</span>
                <span>{m.maxMs}ms</span>
              </div>
            ))}
            {diag && diag.metrics.length === 0 && <div className="diag-empty">No RPC traffic yet.</div>}
          </div>
        )}
        {tab === "health" && h && <pre className="diag-pre">{JSON.stringify(h, null, 2)}</pre>}
        {tab === "audit" && (
          <div className="diag-events">
            {(audit ?? [])
              .slice()
              .reverse()
              .map((a, i) => (
                <div key={i} className="diag-row">
                  <span className="diag-kind">{a.type}</span>
                  <span className="diag-msg">
                    {[a.paneId && "pane " + a.paneId, a.deviceId && "dev " + a.deviceId, a.bytes != null && a.bytes + "B", a.name, a.reason].filter(Boolean).join(" · ")}
                  </span>
                  <span className="diag-ms">{new Date(a.at).toLocaleTimeString()}</span>
                </div>
              ))}
            {audit && audit.length === 0 && <div className="diag-empty">No RCE-channel activity recorded yet.</div>}
          </div>
        )}
        <div className="keys-hint">Live (2s) · LOCAL-only, never exposed to a paired device · logs persist to ~/Library/Logs/GlaudeCode/engine.log</div>
      </div>
    </div>
  );
}
