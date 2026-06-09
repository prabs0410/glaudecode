import { useEffect, useState } from "react";
import {
  createPairCode,
  engineEndpoint,
  listDevices,
  revokeDevice,
  type PairCode,
  type PairedDevice,
  type TokenScope,
} from "./engine";

// Pair-a-device UI (Epic G §3.2). Generate a short, expiring, scoped pairing code; show it
// plus the localhost cockpit URL. Remote access is the user's responsibility (Tailscale/SSH
// tunnel/cloudflared with TLS) — the engine stays localhost-only by default. List and revoke
// paired devices. The raw engine token is never shown or shared.

export function PairingModal({ onClose }: { onClose: () => void }) {
  const [scope, setScope] = useState<TokenScope>("steer");
  const [code, setCode] = useState<PairCode | null>(null);
  const [url, setUrl] = useState<string>("");
  const [devices, setDevices] = useState<PairedDevice[]>([]);

  const reloadDevices = () => listDevices().then(setDevices).catch(() => setDevices([]));
  useEffect(() => {
    void reloadDevices();
    engineEndpoint()
      .then((e) => setUrl(`http://localhost:${e.port}/app`))
      .catch(() => setUrl(""));
  }, []);

  const generate = async () => {
    setCode(await createPairCode(scope));
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

        <div className="pair-gen">
          <label className="pair-scope">
            <input type="checkbox" checked={scope === "steer"} onChange={(e) => setScope(e.currentTarget.checked ? "steer" : "view")} />
            allow steering (answer approvals)
          </label>
          <button className="act" onClick={() => void generate()}>
            Generate code
          </button>
        </div>

        {code && (
          <div className="pair-code-box">
            <div className="pair-code">{code.code}</div>
            <div className="muted-note">
              {code.scope} · expires {new Date(code.expiresAt).toLocaleTimeString()}
            </div>
            {url && <div className="muted-note">Open {url} on the device, enter the code.</div>}
            <div className="muted-note">Remote access needs your own transport (Tailscale/SSH tunnel) with TLS — the engine stays localhost-only.</div>
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
