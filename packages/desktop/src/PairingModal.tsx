import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import qrcode from "qrcode-generator";
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

/** A QR data-URL for the "Connect my phone" handoff: the pair code rides in the URL FRAGMENT
 *  (#code=…) so it never hits server logs / Referer, consistent with token-off-the-query-string. */
function pairQr(cockpitUrl: string, code: string): string {
  try {
    const qr = qrcode(0, "M");
    qr.addData(`${cockpitUrl}#code=${code}`);
    qr.make();
    return qr.createDataURL(5, 8);
  } catch {
    return "";
  }
}

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
  // First-run "remote shell is RCE" consent before the first remote bind (V5 Phase 7.5.1).
  const [showConsent, setShowConsent] = useState(false);
  const [showTermConsent, setShowTermConsent] = useState(false);

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

  const mintCode = async () => {
    setError(null);
    try {
      setCode(await createPairCode(scope));
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  };

  const generate = async () => {
    // Minting a TERMINAL-scope code hands out remote code execution — gate it behind a dedicated,
    // per-mint confirm, distinct from the once-ever remote-enable consent (audit M8). The remote
    // toggle's consent acknowledges the capability exists; THIS confirms the deliberate act of
    // handing it out, every time.
    if (scope === "terminal") {
      setShowTermConsent(true);
      return;
    }
    await mintCode();
  };

  const acceptTermConsent = async () => {
    setShowTermConsent(false);
    await mintCode();
  };

  const acceptConsent = () => {
    localStorage.setItem("glaude.remoteConsent", "1");
    setShowConsent(false);
    void toggleRemote(); // now consented → proceeds to enable
  };

  const toggleRemote = async () => {
    // First-run gate: enabling remote = exposing a remote shell (RCE). Require explicit consent once.
    if (!remoteOn && localStorage.getItem("glaude.remoteConsent") !== "1") {
      setShowConsent(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (remoteOn) {
        // Turn off whichever path is active.
        if (serveUrl) {
          // A FAILED stop leaves the box remotely reachable — let it surface (don't swallow), and
          // only clear the UI once it actually stops (audit L14).
          await invoke("tailscale_serve_stop");
          setServeUrl("");
        }
        if (remote?.enabled) setRemote(await disableRemote());
        await invoke("set_keep_awake", { on: false }).catch(() => {}); // let the Mac sleep again
      } else {
        // Prefer Tailscale Serve (real TLS on the MagicDNS name → installable PWA + clean wss). The
        // engine stays localhost-only; Serve proxies it (it reads the engine port from its own state,
        // not a param — audit M17). Fall back to the plain tailnet bind.
        try {
          const url = await invoke<string>("tailscale_serve_start");
          setServeUrl(url);
        } catch (serveErr: any) {
          const ip = await invoke<string | null>("tailscale_ip");
          if (!ip) {
            setError("Tailscale not found — is it installed and running on this Mac?");
            return;
          }
          setRemote(await enableRemote(ip));
          // Don't degrade SILENTLY: tell the user Serve failed and they're on the weaker plain bind
          // (no TLS / not installable), with the reason (audit M16).
          setError(
            "Tailscale Serve unavailable — using a plain tailnet bind (no HTTPS / installable PWA). " +
              "Enable MagicDNS + HTTPS certificates in your Tailscale admin console to use Serve. (" +
              String(serveErr?.message ?? serveErr) +
              ")",
          );
        }
        await invoke("set_keep_awake", { on: true }).catch(() => {}); // keep the Mac awake while reachable
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
    // Revoking a device is a SECURITY action — a silent failure must not look like success (audit L14).
    try {
      await revokeDevice(id);
      await reloadDevices();
      setError(null);
    } catch (e: any) {
      setError("Couldn't revoke that device: " + String(e?.message ?? e));
    }
  };

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="pair-modal" onClick={(e) => e.stopPropagation()}>
        <div className="keys-head">
          <span>Pair a device</span>
        </div>

        {showConsent && (
          <div className="consent">
            <div className="dock-error">
              ⚠ Enabling remote access lets a <strong>paired device run commands on this machine</strong> —
              this is remote code execution. Pair only devices you control. Each terminal pane still
              defaults to <strong>not</strong> accepting input (you arm it explicitly), and you can
              disable remote or disarm everything at any time.
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="act danger" onClick={acceptConsent}>I understand — enable</button>
              <button className="act" onClick={() => setShowConsent(false)}>Cancel</button>
            </div>
          </div>
        )}

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
          {remoteOn && (
            <div className="muted-note">
              ⚠ On a <strong>shared</strong> tailnet, lock the engine to your phone's node —
              see <code>docs/design/transport-acl-hardening.md</code>.
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
          {showTermConsent && (
            <div className="consent" style={{ marginTop: 6 }}>
              <div className="dock-error">
                ⚠ You're about to mint a <strong>TERMINAL</strong> pairing code. A device that redeems
                it can <strong>run commands on this Mac</strong> (remote code execution). Only hand
                this code to a device you personally control, over a network you trust.
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <button className="act danger" onClick={() => void acceptTermConsent()}>
                  I understand — generate terminal code
                </button>
                <button className="act" onClick={() => setShowTermConsent(false)}>Cancel</button>
              </div>
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
            {cockpitUrl && pairQr(cockpitUrl, code.code) && (
              <img
                className="pair-qr"
                alt="Scan with your phone to connect"
                src={pairQr(cockpitUrl, code.code)}
                style={{ width: 180, height: 180, imageRendering: "pixelated", margin: "8px 0", background: "#fff", borderRadius: 6 }}
              />
            )}
            {cockpitUrl && (
              <div className="muted-note pair-url">
                Scan the QR, or open <code>{cockpitUrl}</code> and enter the code.
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
