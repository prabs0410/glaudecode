import { useRef, useState } from "react";
import type { ITheme } from "@xterm/xterm";
import { TerminalPane } from "./TerminalPane";
import { ConflictBanner } from "./ConflictBanner";
import { MetaAgentPanel } from "./MetaAgentPanel";

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
  /** Second pane shown side-by-side with the active one (V3-E1). */
  splitPaneId?: string | null;
  onSelectPane: (paneId: string) => void;
  onClosePane: (paneId: string) => void;
  onNewShell: () => void;
  onNewClaude: (branch: string) => Promise<void>;
  onHandoff: (fromPaneId: string, toPaneId: string) => Promise<void>;
  /** Reorder a tab from one index to another (drag-and-drop). */
  onReorder: (from: number, to: number) => void;
  /** Worktree creation needs a known project dir; disable the control until then. */
  canCreateSession: boolean;
  /** Shared terminal font size (px). */
  fontSize: number;
  /** Whether the in-terminal search bar is open (shown on the active pane). */
  searchOpen: boolean;
  onCloseSearch: () => void;
  copyOnSelect: boolean;
  cursorStyle: "block" | "bar" | "underline";
  cursorBlink: boolean;
  theme: ITheme;
}

// The workspace: a tab bar over N panes plus the "new session" flow. All panes stay
// mounted (so background sessions keep streaming); only the active one is visible.
export function Workspace({
  panes,
  activePaneId,
  splitPaneId = null,
  onSelectPane,
  onClosePane,
  onNewShell,
  onNewClaude,
  onHandoff,
  onReorder,
  canCreateSession,
  fontSize,
  searchOpen,
  onCloseSearch,
  copyOnSelect,
  cursorStyle,
  cursorBlink,
  theme,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [branch, setBranch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const dragIdx = useRef<number | null>(null);

  const active = panes.find((p) => p.paneId === activePaneId);
  const handoffTargets =
    active?.kind === "claude"
      ? panes.filter((p) => p.kind === "claude" && p.paneId !== active.paneId)
      : [];
  // Live Claude sessions feed the cross-session widgets (conflicts, advisor).
  const liveSessions = panes
    .filter((p) => p.kind === "claude" && p.sessionId && p.cwd)
    .map((p) => ({ id: p.sessionId!, dir: p.cwd!, title: p.title }));

  const doHandoff = async (toId: string) => {
    if (!active) return;
    setHandoffBusy(true);
    setError(null);
    try {
      await onHandoff(active.paneId, toId);
      setHandoffOpen(false);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setHandoffBusy(false);
    }
  };

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
          {panes.map((p, i) => (
            <div
              key={p.paneId}
              className={`tab${p.paneId === activePaneId ? " active" : ""}`}
              onClick={() => onSelectPane(p.paneId)}
              title={p.worktreePath ?? p.cwd ?? p.title}
              draggable
              onDragStart={() => (dragIdx.current = i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragIdx.current !== null && dragIdx.current !== i) onReorder(dragIdx.current, i);
                dragIdx.current = null;
              }}
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
              {handoffTargets.length > 0 && (
                <div className="handoff">
                  <button
                    className="act"
                    title="Hand this session's context to another"
                    onClick={() => setHandoffOpen((o) => !o)}
                  >
                    ⇄ Hand off
                  </button>
                  {handoffOpen && (
                    <div className="handoff-menu">
                      {handoffTargets.map((t) => (
                        <button
                          key={t.paneId}
                          className="handoff-item"
                          disabled={handoffBusy}
                          onClick={() => void doHandoff(t.paneId)}
                        >
                          {t.title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
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

      <ConflictBanner sessions={liveSessions} />
      <MetaAgentPanel sessions={liveSessions} />

      <div className="panes">
        {panes.map((p) => (
          <div
            key={p.paneId}
            className={`pane-mount${p.paneId === splitPaneId ? " split" : ""}`}
            style={{ display: p.paneId === activePaneId || p.paneId === splitPaneId ? "block" : "none" }}
          >
            <TerminalPane
              paneId={p.paneId}
              cwd={p.cwd}
              cmd={p.cmd}
              args={p.args}
              fontSize={fontSize}
              searchActive={searchOpen && p.paneId === activePaneId}
              onCloseSearch={onCloseSearch}
              copyOnSelect={copyOnSelect}
              cursorStyle={cursorStyle}
              cursorBlink={cursorBlink}
              theme={theme}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
