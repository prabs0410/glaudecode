import { useCallback, useEffect, useState } from "react";
import {
  approvalHookStatus,
  installApprovalHook,
  pendingApprovals,
  resolveApproval,
  uninstallApprovalHook,
  type ApprovalRequest,
} from "./engine";

// Smart-approval UI (Epic C §3.2). OPT-IN: a toggle installs/removes the PreToolUse hook
// in .claude/settings.json. When on, dangerous tool calls pause for a decision and appear
// here as non-blocking cards — the terminal stream is never interrupted. Read-only tools
// auto-allow; the user clicks Allow/Deny and the waiting hook is released.
const POLL_MS = 1500;

export function ApprovalPanel({ dir }: { dir: string | null }) {
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Reflect the on-disk hook status whenever the project changes.
  useEffect(() => {
    if (!dir) {
      setInstalled(null);
      return;
    }
    approvalHookStatus(dir)
      .then((s) => setInstalled(s.installed))
      .catch(() => setInstalled(null));
  }, [dir]);

  // Poll for pending approvals while smart approval is on.
  useEffect(() => {
    if (!dir || !installed) {
      setRequests([]);
      return;
    }
    let alive = true;
    const poll = async () => {
      try {
        const list = await pendingApprovals();
        if (alive) setRequests(list);
      } catch {
        /* transient */
      }
    };
    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [dir, installed]);

  const toggle = useCallback(async () => {
    if (!dir) return;
    setBusy(true);
    setError(null);
    try {
      if (installed) await uninstallApprovalHook(dir);
      else await installApprovalHook(dir);
      const s = await approvalHookStatus(dir);
      setInstalled(s.installed);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }, [dir, installed]);

  const decide = async (id: string, decision: "allow" | "deny") => {
    setRequests((rs) => rs.filter((r) => r.id !== id)); // optimistic
    try {
      await resolveApproval(id, decision);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  };

  if (!dir) return null;

  return (
    <div className="approval-layer">
      <button
        className={`approval-switch${installed ? " on" : ""}`}
        disabled={busy}
        onClick={() => void toggle()}
        title="Install a PreToolUse hook so dangerous tool calls ask for approval here"
      >
        <span className="approval-switch-dot" /> Smart approval {installed ? "On" : "Off"}
      </button>

      {error && <div className="approval-error">{error}</div>}

      {requests.map((r) => (
        <div key={r.id} className={`approval-card${r.dangerous ? " danger" : ""}`}>
          <div className="approval-head">
            <span className="approval-tool">{r.tool}</span>
            {r.dangerous && <span className="approval-badge">dangerous</span>}
          </div>
          <div className="approval-detail">{summarize(r.input)}</div>
          <div className="approval-reason">{r.reason}</div>
          <div className="approval-actions">
            <button className="act" onClick={() => void decide(r.id, "allow")}>
              Allow
            </button>
            <button className="act danger" onClick={() => void decide(r.id, "deny")}>
              Deny
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function summarize(input: unknown): string {
  const i = input as any;
  if (i?.command) return String(i.command);
  if (i?.file_path) return String(i.file_path);
  if (i?.notebook_path) return String(i.notebook_path);
  const s = JSON.stringify(input ?? {});
  return s.length > 200 ? s.slice(0, 200) + "…" : s;
}
