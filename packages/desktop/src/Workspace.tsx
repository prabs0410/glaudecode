import { useState } from "react";
import { TerminalPane } from "./TerminalPane";

// A pane is one terminal tab: either a plain shell or a Claude Code session bound to
// a worktree. For Claude panes `paneId === sessionId` (the uuid we mint and pass to
// `claude --session-id`), giving a deterministic pane↔session binding (Epic A §3.3).
export interface Pane {
  paneId: string;
  kind: "shell" | "claude";
  title: string;
  cwd?: string;
  cmd?: string;
  args?: string[];
  sessionId?: string;
  worktreePath?: string;
}

interface Props {
  panes: Pane[];
  activePaneId: string | null;
  onSelectPane: (paneId: string) => void;
  onClosePane: (paneId: string) => void;
  onNewShell: () => void;
  onNewClaude: (branch: string) => Promise<void>;
  /** Worktree creation needs a known project dir; disable the control until then. */
  canCreateSession: boolean;
}

// The workspace: a tab bar over N panes plus the "new session" flow. All panes stay
// mounted (so background sessions keep streaming); only the active one is visible.
export function Workspace({
  panes,
  activePaneId,
  onSelectPane,
  onClosePane,
  onNewShell,
  onNewClaude,
  canCreateSession,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [branch, setBranch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const name = branch.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      await onNewClaude(name);
      setBranch("");
      setCreating(false);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="workspace">
      <div className="tabbar">
        <div className="tabs">
          {panes.map((p) => (
            <div
              key={p.paneId}
              className={`tab${p.paneId === activePaneId ? " active" : ""}`}
              onClick={() => onSelectPane(p.paneId)}
              title={p.worktreePath ?? p.cwd ?? p.title}
            >
              <span className={`tab-kind ${p.kind}`} />
              <span className="tab-title">{p.title}</span>
              {panes.length > 1 && (
                <button
                  className="tab-close"
                  title="Close pane"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClosePane(p.paneId);
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="tab-new">
          {creating ? (
            <div className="newsession">
              <input
                className="newsession-input"
                autoFocus
                placeholder="branch name…"
                value={branch}
                disabled={busy}
                onChange={(e) => setBranch(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit();
                  if (e.key === "Escape") {
                    setCreating(false);
                    setError(null);
                  }
                }}
                spellCheck={false}
              />
              <button className="act" disabled={busy} onClick={() => void submit()}>
                {busy ? "…" : "Create"}
              </button>
              <button
                className="act"
                disabled={busy}
                onClick={() => {
                  setCreating(false);
                  setError(null);
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              <button
                className="act"
                title="New Claude session in a fresh worktree"
                disabled={!canCreateSession}
                onClick={() => setCreating(true)}
              >
                ＋ Claude
              </button>
              <button className="act" title="New shell pane" onClick={onNewShell}>
                ＋ Shell
              </button>
            </>
          )}
        </div>
      </div>

      {error && <div className="workspace-error">{error}</div>}

      <div className="panes">
        {panes.map((p) => (
          <div
            key={p.paneId}
            className="pane-mount"
            style={{ display: p.paneId === activePaneId ? "block" : "none" }}
          >
            <TerminalPane paneId={p.paneId} cwd={p.cwd} cmd={p.cmd} args={p.args} />
          </div>
        ))}
      </div>
    </section>
  );
}
