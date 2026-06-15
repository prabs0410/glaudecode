import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ITheme } from "@xterm/xterm";
import { listen } from "@tauri-apps/api/event";
import { TerminalPane } from "./TerminalPane";
import { ConflictBanner } from "./ConflictBanner";
import { MetaAgentPanel } from "./MetaAgentPanel";
import { Splitter } from "./Splitter";
import { setPaneArmed, disarmAllPanes, listArmed } from "./engine";

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
  /** Width (px) of the active/left pane when split; the right pane fills the rest (V4-C1). */
  splitW?: number;
  onSplitResize?: (next: number) => void;
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
  /** Reports a pane's live cwd (OSC 7) up to the app so the sidebar/dock can follow it. */
  onPaneCwd?: (paneId: string, cwd: string) => void;
}

// The workspace: a tab bar over N panes plus the "new session" flow. All panes stay
// mounted (so background sessions keep streaming); only the active one is visible.
export function Workspace({
  panes,
  activePaneId,
  splitPaneId = null,
  splitW = 480,
  onSplitResize,
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
  onPaneCwd,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [branch, setBranch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const dragIdx = useRef<number | null>(null);

  // Remote-input arming (V5 Phase 2). `armed` = panes opted in to phone keystrokes (default none);
  // `driving` = panes a phone is actively typing into right now (a brief live echo). Arm state is
  // owned by the Rust core; this mirrors it for the UI. The kill switch disarms everything.
  const [armed, setArmed] = useState<Set<string>>(new Set());
  const [driving, setDriving] = useState<Set<string>>(new Set());
  const driveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Hydrate `armed` from the AUTHORITATIVE Rust core on mount + on focus/visibility (audit H2). A
  // WebView reload (vite HMR, ErrorBoundary remount, any refresh) re-runs this renderer WITHOUT
  // respawning Rust/engine — so a pane still armed in Rust (still accepting phone keystrokes) must
  // re-appear as armed here, or the 📱 toggle silently reads "off" and the kill switch disappears
  // while input keeps flowing. We also subscribe to `armed-changed` (Rust pushes it on every
  // arm/disarm/kill) so the mirror can never drift. On a read error we KEEP the last-known set rather
  // than clear to empty (clearing would fail-UNSAFE by hiding the kill switch).
  useEffect(() => {
    let alive = true;
    const hydrate = () =>
      void listArmed()
        .then((ids) => alive && setArmed(new Set(ids)))
        .catch(() => {});
    hydrate();
    const onFocus = () => hydrate();
    const onVis = () => document.visibilityState === "visible" && hydrate();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    const unlistenP = listen<string[]>("armed-changed", (e) => alive && setArmed(new Set(e.payload)));
    return () => {
      alive = false;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
      void unlistenP.then((un) => un());
    };
  }, []);

  const toggleArm = async (paneId: string) => {
    const next = !armed.has(paneId);
    try {
      await setPaneArmed(paneId, next);
      setArmed((a) => {
        const n = new Set(a);
        next ? n.add(paneId) : n.delete(paneId);
        return n;
      });
    } catch (e) {
      // A silent failure to DISARM is the dangerous direction — surface it (audit L1).
      setError("Couldn't change arm state: " + String((e as Error)?.message ?? e));
    }
  };

  const killSwitch = async () => {
    try {
      await disarmAllPanes();
      // Only clear the UI once Rust has actually disarmed. Also clear the live "driving" echoes —
      // nothing should be typing once disarmed.
      setArmed(new Set());
      setDriving(new Set());
      setError(null);
    } catch (e) {
      // A failed disarm is the DANGEROUS direction: panes may STILL be armed in Rust. Surface it
      // loudly rather than clearing the UI (which would falsely claim "disarmed" — fail-unsafe). The
      // armed set is left intact so the kill switch stays visible to retry; Rust's authoritative
      // armed-changed event keeps it honest.
      setError("Disarm failed — panes may still accept phone input: " + String((e as Error)?.message ?? e));
    }
  };

  // Flash a "📱 driving" badge on a pane whenever a phone writes to it (pane-remote-input event),
  // and re-listen as panes come and go. Also prune armed/driving for panes that have closed.
  const paneIdsKey = panes.map((p) => p.paneId).join(",");
  useEffect(() => {
    let alive = true;
    const unlistens: Array<() => void> = [];
    for (const p of panes) {
      void listen(`pane-remote-input:${p.paneId}`, () => {
        setDriving((d) => new Set(d).add(p.paneId));
        clearTimeout(driveTimers.current[p.paneId]);
        driveTimers.current[p.paneId] = setTimeout(() => {
          setDriving((d) => {
            const n = new Set(d);
            n.delete(p.paneId);
            return n;
          });
        }, 1500);
      }).then((un) => (alive ? unlistens.push(un) : un()));
    }
    const ids = new Set(panes.map((p) => p.paneId));
    setArmed((a) => (([...a].every((id) => ids.has(id))) ? a : new Set([...a].filter((id) => ids.has(id)))));
    const timers = driveTimers.current;
    return () => {
      alive = false;
      unlistens.forEach((u) => u());
      // Clear every pending drive-echo timer (audit L8) — otherwise they fire setDriving after the
      // effect tears down (a leak + a setState-after-unmount on the last unmount).
      for (const id of Object.keys(timers)) clearTimeout(timers[id]);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneIdsKey]);

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
              <button
                className={`tab-arm${armed.has(p.paneId) ? " on" : ""}${driving.has(p.paneId) ? " driving" : ""}`}
                aria-pressed={armed.has(p.paneId)}
                aria-label={
                  armed.has(p.paneId)
                    ? "Phone input allowed for this pane — click to disarm"
                    : "Allow phone (remote) input for this pane — currently off"
                }
                title={
                  armed.has(p.paneId)
                    ? "Phone input ALLOWED for this pane — click to disarm"
                    : "Allow phone (remote) input for this pane — off"
                }
                onClick={(e) => {
                  e.stopPropagation();
                  void toggleArm(p.paneId);
                }}
              >
                {/* Non-color armed cue (audit L15): a lock glyph in addition to the colored ring. */}
                {armed.has(p.paneId) ? "📱🔓" : "📱"}
              </button>
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
          {armed.size > 0 && (
            <button
              className="act danger arm-kill"
              title="Disarm all panes — immediately stop all phone input"
              onClick={() => void killSwitch()}
            >
              ⛔ Disarm all ({armed.size})
            </button>
          )}
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
        {/* Splitter between the two visible panes. All panes stay mounted (display-toggled) to keep
            their PTY state, so we can't reorder the DOM physically — CSS `order` places it between
            the active (order 1) and split (order 3) panes regardless of array position (V4-C1). */}
        {splitPaneId && (
          <div className="pane-splitter" style={{ order: 2 }}>
            <Splitter value={splitW} min={240} max={1200} sign={1} onChange={(w) => onSplitResize?.(w)} />
          </div>
        )}
        {panes.map((p) => {
          const isActive = p.paneId === activePaneId;
          const isSplit = p.paneId === splitPaneId;
          const visible = isActive || isSplit;
          // When split: active pane is a fixed width (left), split pane flexes to fill (right).
          const style: CSSProperties = splitPaneId
            ? {
                display: visible ? "block" : "none",
                order: isActive ? 1 : isSplit ? 3 : 0,
                flex: isActive ? `0 0 ${splitW}px` : isSplit ? "1 1 0" : undefined,
              }
            : { display: visible ? "block" : "none" };
          return (
          <div
            key={p.paneId}
            className={`pane-mount${isSplit ? " split" : ""}`}
            style={style}
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
              onCwd={(cwd) => onPaneCwd?.(p.paneId, cwd)}
            />
          </div>
          );
        })}
      </div>
    </section>
  );
}
