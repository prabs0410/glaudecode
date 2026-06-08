import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { RightDock } from "./RightDock";
import { Workspace, type Pane } from "./Workspace";
import { ApprovalPanel } from "./ApprovalPanel";
import { createWorktree, handoff, projectDir } from "./engine";
import "./App.css";

const INITIAL_PANES: Pane[] = [{ paneId: "main", kind: "shell", title: "Shell" }];

export default function App() {
  const [dir, setDir] = useState<string | null>(null);
  const [panes, setPanes] = useState<Pane[]>(INITIAL_PANES);
  const [activePaneId, setActivePaneId] = useState<string>("main");
  // What the right dock + status bar inspect: the active Claude pane's session, or a
  // session clicked in the sidebar. Last focus wins.
  const [inspect, setInspect] = useState<{ sessionId: string; dir: string } | null>(null);

  useEffect(() => {
    projectDir()
      .then(setDir)
      .catch(() => setDir(null));
  }, []);

  const liveSessionIds = useMemo(
    () => new Set(panes.filter((p) => p.kind === "claude" && p.sessionId).map((p) => p.sessionId!)),
    [panes],
  );
  const liveSessions = useMemo(
    () =>
      panes
        .filter((p) => p.kind === "claude" && p.sessionId && p.cwd)
        .map((p) => ({ id: p.sessionId!, dir: p.cwd! })),
    [panes],
  );

  const selectPane = (paneId: string) => {
    setActivePaneId(paneId);
    const p = panes.find((x) => x.paneId === paneId);
    if (p?.kind === "claude" && p.sessionId) {
      setInspect({ sessionId: p.sessionId, dir: p.cwd ?? dir ?? "" });
    }
  };

  const newShell = () => {
    const id = crypto.randomUUID();
    setPanes((ps) => [...ps, { paneId: id, kind: "shell", title: "Shell", cwd: dir ?? undefined }]);
    setActivePaneId(id);
  };

  // Create a worktree on a new branch, mint a session id, and open a Claude pane that
  // spawns `claude --session-id <uuid>` there — deterministic pane↔session binding.
  const newClaude = async (branch: string) => {
    if (!dir) throw new Error("no project directory");
    const { path } = await createWorktree(dir, branch);
    const uuid = crypto.randomUUID();
    const pane: Pane = {
      paneId: uuid,
      kind: "claude",
      title: branch,
      cwd: path,
      worktreePath: path,
      cmd: "claude",
      args: ["--session-id", uuid],
      sessionId: uuid,
    };
    setPanes((ps) => [...ps, pane]);
    setActivePaneId(uuid);
    setInspect({ sessionId: uuid, dir: path });
  };

  const closePane = (paneId: string) => {
    setPanes((ps) => {
      const next = ps.filter((p) => p.paneId !== paneId);
      if (paneId === activePaneId) {
        const idx = ps.findIndex((p) => p.paneId === paneId);
        const neighbor = next[Math.min(idx, next.length - 1)];
        if (neighbor) setActivePaneId(neighbor.paneId);
      }
      return next;
    });
  };

  const selectSession = (id: string) => {
    if (dir) setInspect({ sessionId: id, dir });
  };

  // Hand the source pane's session context into the target pane. We fetch a digest
  // (server-side, tested) and paste it into the target's PTY via bracketed paste so
  // multi-line text arrives as one block for the user to review and send — there is
  // no live inter-session messaging in Claude Code (Epic A §3.5).
  const onHandoff = async (fromPaneId: string, toPaneId: string) => {
    const from = panes.find((p) => p.paneId === fromPaneId);
    if (!from?.sessionId || !from.cwd) throw new Error("source is not a Claude session");
    const { prompt } = await handoff(from.sessionId, from.cwd);
    const bracketed = `\x1b[200~${prompt}\x1b[201~`;
    await invoke("pty_write", { paneId: toPaneId, data: bracketed });
    setActivePaneId(toPaneId);
    const to = panes.find((p) => p.paneId === toPaneId);
    if (to?.sessionId) setInspect({ sessionId: to.sessionId, dir: to.cwd ?? dir ?? "" });
  };

  return (
    <div className="app-root">
      <div className="app-shell">
        <Sidebar
          dir={dir}
          selectedId={inspect?.sessionId ?? null}
          onSelect={selectSession}
          liveSessionIds={liveSessionIds}
        />
        <Workspace
          panes={panes}
          activePaneId={activePaneId}
          onSelectPane={selectPane}
          onClosePane={closePane}
          onNewShell={newShell}
          onNewClaude={newClaude}
          onHandoff={onHandoff}
          canCreateSession={!!dir}
        />
        <RightDock dir={inspect?.dir ?? null} selectedId={inspect?.sessionId ?? null} />
      </div>
      <ApprovalPanel dir={dir} />
      <StatusBar
        dir={inspect?.dir ?? null}
        selectedId={inspect?.sessionId ?? null}
        projectDir={dir}
        liveSessions={liveSessions}
      />
    </div>
  );
}
