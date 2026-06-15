import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  createPairCode,
  disableRemote,
  enableRemote,
  engineEndpoint,
  listDevices,
  remoteStatus,
  revokeDevice,
  type PairCode,
  type PairedDevice,
  type RemoteInfo,
  type TokenScope,
} from "./engine";

// Pair-a-device UI (Epic G §3.2 + remote). Generate a short, expiring, scoped pairing code, and
// optionally expose the engine over Tailscale so a phone on your tailnet can reach the cockpit.
// The remote listener binds ONLY your Tailscale IP (never the LAN or public internet); WireGuard
// encrypts the traffic. List and revoke paired devices. The raw engine token is never shared.

export function PairingModal({ onClose }: { onClose: () => void }) {
  const [scope, setScope] = useState<TokenScope>("steer");
  const [code, setCode] = useState<PairCode | null>(null);
  const [localUrl, setLocalUrl] = useState<string>("");
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [remote, setRemote] = useState<RemoteInfo | null>(null);
  // Tailscale Serve URL (https://<node>.ts.net) when Serve is the active path — the engine then
  // stays localhost-only and Serve proxies it (real TLS → installable PWA). Distinct from `remote`,
  // which is the plain tailnet-IP bind fallback.
  const [serveUrl, setServeUrl] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const reloadDevices = () => listDevices().then(setDevices).catch(() => setDevices([]));
  useEffect(() => {
    void reloadDevices();
    remoteStatus().then(setRemote).catch(() => setRemote(null));
    invoke<string | null>("tailscale_serve_status").then((u) => setServeUrl(u || "")).catch(() => {});
    engineEndpoint()
      .then((e) => setLocalUrl(`http://localhost:${e.port}/app`))
      .catch(() => setLocalUrl(""));
  }, []);

  const remoteOn = !!serveUrl || !!remote?.enabled;
  // The URL to open on the device: Serve's HTTPS URL (PWA) > the plain tailnet bind > localhost.
  const cockpitUrl = serveUrl ? `${serveUrl}/app` : remote?.enabled && remote.url ? remote.url : localUrl;

  const generate = async () => {
    setError(null);
    try {
      setCode(await createPairCode(scope));
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  };

  const toggleRemote = async () => {
    setBusy(true);
    setError(null);
    try {
      if (remoteOn) {
        // Turn off whichever path is active.
        if (serveUrl) {
          await invoke("tailscale_serve_stop").catch(() => {});
          setServeUrl("");
        }
        if (remote?.enabled) setRemote(await disableRemote());
      } else {
        // Prefer Tailscale Serve (real TLS on the MagicDNS name → installable PWA + clean wss). The
        // engine stays localhost-only; Serve proxies it. Fall back to the plain tailnet bind.
        const ep = await engineEndpoint();
        try {
          const url = await invoke<string>("tailscale_serve_start", { port: ep.port });
          setServeUrl(url);
        } catch {
          const ip = await invoke<string | null>("tailscale_ip");
          if (!ip) {
            setError("Tailscale not found — is it installed and running on this Mac?");
            return;
          }
          setRemote(await enableRemote(ip));
        }
      }
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(cockpitUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };

  const revoke = async (id: string) => {
    await revokeDevice(id);
    await reloadDevices();
  };

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="pair-modal" onClick={(e) => e.stopPropagation()}>
        <div className="keys-head">
          <span>Pair a device</span>
        </div>

        {/* Remote access over Tailscale */}
        <div className="pair-remote">
          <label className="pair-scope">
            <input type="checkbox" checked={remoteOn} disabled={busy} onChange={() => void toggleRemote()} />
            Remote access over Tailscale {busy && <span className="muted-note">…</span>}
          </label>
          {serveUrl ? (
            <div className="muted-note">
              On via <strong>Tailscale Serve</strong> (real TLS, installable) at <code>{serveUrl}</code>. Tailnet-only. Disable to stop.
            </div>
          ) : remote?.enabled ? (
            <div className="muted-note">
              On (plain tailnet bind) at <code>{remote.hostname}</code>. Tip: enable MagicDNS + HTTPS
              certs in your Tailscale admin console to upgrade to Serve (installable PWA over wss). Disable to stop.
            </div>
          ) : (
            <div className="muted-note">
              Off — the engine is localhost-only. Turn on to reach the cockpit from your phone over
              your tailnet (WireGuard-encrypted); prefers Tailscale Serve, falls back to a plain bind.
            </div>
          )}
        </div>

        {error && <div className="dock-error">{error}</div>}

        <div className="pair-gen">
          <label className="pair-scope">
            Device access:
            <select value={scope} onChange={(e) => setScope(e.currentTarget.value as TokenScope)}>
              <option value="view">View only — watch sessions + terminals (read)</option>
              <option value="steer">Steer — also answer approvals / send follow-ups</option>
              <option value="terminal">Terminal — also type into armed panes (full control)</option>
            </select>
          </label>
          {scope === "terminal" && (
            <div className="dock-error" style={{ marginTop: 6 }}>
              ⚠ Terminal access lets this device run commands on your Mac — this is remote code
              execution. Only pair a device you personally control. Panes still default to NOT
              accepting input; you arm each pane explicitly (📱 on its tab), and can disarm all at once.
            </div>
          )}
          <button className="act" onClick={() => void generate()} style={{ marginTop: 6 }}>
            Generate code
          </button>
        </div>

        {code && (
          <div className="pair-code-box">
            <div className="pair-code">{code.code}</div>
            <div className="muted-note">
              {code.scope} · expires {new Date(code.expiresAt).toLocaleTimeString()}
            </div>
            {cockpitUrl && (
              <div className="muted-note pair-url">
                Open <code>{cockpitUrl}</code> on the device, enter the code.
                <button className="act mini" onClick={() => void copyUrl()}>
                  {copied ? "copied" : "Copy URL"}
                </button>
              </div>
            )}
            {!remoteOn && (
              <div className="muted-note">
                Tip: turn on remote access above so the device can reach this URL over Tailscale —
                otherwise it only works in a browser on this Mac.
              </div>
            )}
          </div>
        )}

        <div className="keys-head" style={{ marginTop: 12 }}>
          <span>Paired devices</span>
        </div>
        <ul className="keys-list">
          {devices.length === 0 && <li className="muted-note">No paired devices.</li>}
          {devices.map((d) => (
            <li key={d.id} className="keys-row">
              <span className="keys-cmd">
                {d.name} <span className="muted-note">({d.scope})</span>
              </span>
              <span className="muted-note">{d.lastSeen ? "seen " + new Date(d.lastSeen).toLocaleTimeString() : "—"}</span>
              <button className="act danger" onClick={() => void revoke(d.id)}>
                Revoke
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
