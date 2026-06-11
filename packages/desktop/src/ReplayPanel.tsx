import { useState } from "react";
import { buildReplay, type ReplayBundle } from "./engine";

// Replay / share (Epic E §3.6). Export the selected session as a portable JSON bundle
// (redacted by default — with an explicit, honest warning that redaction is best-effort)
// and open a bundle to view it read-only. Nothing is uploaded; the user shares the file.

export function ReplayPanel({ dir, selectedId }: { dir: string | null; selectedId: string | null }) {
  const [redact, setRedact] = useState(true);
  const [bundle, setBundle] = useState<ReplayBundle | null>(null);
  const [json, setJson] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exportSession = async () => {
    if (!dir || !selectedId) return;
    setError(null);
    try {
      const b = await buildReplay(selectedId, dir, redact);
      setBundle(b);
      setJson(JSON.stringify(b, null, 2));
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };

  const download = () => {
    try {
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `replay-${selectedId?.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* fall back to copy */
    }
  };

  const openFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const b = JSON.parse(String(reader.result)) as ReplayBundle;
        setBundle(b);
        setJson(String(reader.result));
      } catch (e: any) {
        setError("Not a valid replay file");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="replay-panel">
      <div className="replay-actions">
        <button className="act" disabled={!selectedId} onClick={() => void exportSession()}>
          Export session
        </button>
        <label className="replay-redact">
          <input type="checkbox" checked={redact} onChange={(e) => setRedact(e.currentTarget.checked)} /> redact secrets
        </label>
        <label className="act replay-import">
          Open…
          <input
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={(e) => e.currentTarget.files?.[0] && openFile(e.currentTarget.files[0])}
          />
        </label>
      </div>

      {!selectedId && !bundle && (
        <div className="dock-empty">
          Open or focus a Claude session to export it — or open a saved bundle above.
        </div>
      )}

      {(selectedId || bundle) && (
        <div className="replay-warn">
          ⚠ Redaction is best-effort, not a guarantee. Review before sharing — transcripts may still
          contain secrets.
        </div>
      )}

      {error && <div className="dock-error">{error}</div>}

      {bundle && (
        <>
          <div className="replay-meta">
            session {bundle.sessionId.slice(0, 8)} · {bundle.entries.length} entries ·{" "}
            {bundle.redacted ? "redacted" : "NOT redacted"}
            <span className="replay-buttons">
              <button className="act mini" onClick={() => void copy()}>
                {copied ? "copied" : "Copy"}
              </button>
              <button className="act mini" onClick={download}>
                Download
              </button>
            </span>
          </div>
          <div className="replay-entries">
            {bundle.entries.map((e) => (
              <div key={e.id} className="replay-entry">
                <span className={`replay-role ${e.role}`}>{e.role}</span>
                <span className="replay-text">{entryText(e)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function entryText(e: ReplayBundle["entries"][number]): string {
  const text = e.blocks
    .map((b) => (b.text ? b.text : b.kind === "tool_use" ? `⚙ ${b.name ?? "tool"}` : ""))
    .filter(Boolean)
    .join(" ");
  return text.length > 200 ? text.slice(0, 200) + "…" : text || "(no text)";
}
