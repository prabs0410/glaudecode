import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { RightDock } from "./RightDock";
import { Workspace, type Pane } from "./Workspace";
import { ApprovalPanel } from "./ApprovalPanel";
import { CommandPalette, type Command } from "./CommandPalette";
import { KeybindingsModal } from "./KeybindingsModal";
import { PromptsModal } from "./PromptsModal";
import { NotificationService } from "./NotificationService";
import { PairingModal } from "./PairingModal";
import { Splitter } from "./Splitter";
import { matchEvent } from "./keybindings";
import { createWorktree, getKeybindings, handoff, projectDir, reindex, type Keybinding } from "./engine";
import "./App.css";

const INITIAL_PANES: Pane[] = [{ paneId: "main", kind: "shell", title: "Shell" }];

const num = (v: string | null, fallback: number) => {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};

export default function App() {
  const [dir, setDir] = useState<string | null>(null);
  const [panes, setPanes] = useState<Pane[]>(INITIAL_PANES);
  const [activePaneId, setActivePaneId] = useState<string>("main");
  // What the right dock + status bar inspect: the active Claude pane's session, or a
  // session clicked in the sidebar. Last focus wins.
  const [inspect, setInspect] = useState<{ sessionId: string; dir: string } | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [keybindingsOpen, setKeybindingsOpen] = useState(false);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [quiet, setQuiet] = useState(() => localStorage.getItem("glaude.quiet") === "1");
  const [pairingOpen, setPairingOpen] = useState(false);
  // Resizable panel widths, remembered across launches.
  const [sidebarW, setSidebarW] = useState(() => num(localStorage.getItem("glaude.sidebarW"), 260));
  const [dockW, setDockW] = useState(() => num(localStorage.getItem("glaude.dockW"), 320));
  const [fontSize, setFontSize] = useState(() => num(localStorage.getItem("glaude.fontSize"), 13));
  useEffect(() => localStorage.setItem("glaude.fontSize", String(fontSize)), [fontSize]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [copyOnSelect, setCopyOnSelect] = useState(() => localStorage.getItem("glaude.copyOnSelect") === "1");
  useEffect(() => localStorage.setItem("glaude.copyOnSelect", copyOnSelect ? "1" : "0"), [copyOnSelect]);
  useEffect(() => localStorage.setItem("glaude.sidebarW", String(sidebarW)), [sidebarW]);
  useEffect(() => localStorage.setItem("glaude.dockW", String(dockW)), [dockW]);

  // Window title reflects the active pane (a Claude session's name, or the project dir).
  useEffect(() => {
    const active = panes.find((p) => p.paneId === activePaneId);
    const ctx =
      active?.kind === "claude" ? active.title : dir ? dir.split("/").filter(Boolean).pop() : null;
    void getCurrentWindow()
      .setTitle(ctx ? `GlaudeCode — ${ctx}` : "GlaudeCode")
      .catch(() => {});
  }, [activePaneId, panes, dir]);
  const [keymap, setKeymap] = useState<Keybinding[]>([]);
  const commandsRef = useRef<Command[]>([]);

  useEffect(() => {
    projectDir()
      .then(setDir)
      .catch(() => setDir(null));
    getKeybindings()
      .then((k) => setKeymap(k.bindings))
      .catch(() => setKeymap([]));
  }, []);

  // Global keybinding dispatch (Epic F §3.2): match the chord against the effective keymap
  // and run the bound command. Only modifier chords match, so plain terminal typing is
  // untouched. The command closures live in a ref so the listener stays stable.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cmdId = matchEvent(e, keymap);
      if (!cmdId) return;
      e.preventDefault();
      void commandsRef.current.find((c) => c.id === cmdId)?.run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keymap]);

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

  const cyclePane = (delta: number) => {
    setPanes((ps) => {
      if (ps.length < 2) return ps;
      const idx = ps.findIndex((p) => p.paneId === activePaneId);
      const next = ps[(idx + delta + ps.length) % ps.length];
      if (next) selectPane(next.paneId);
      return ps;
    });
  };

  // App actions exposed in the palette + bound to keys (ids match DEFAULT_KEYBINDINGS).
  // Extensions could append here.
  const commands: Command[] = useMemo(
    () => [
      { id: "palette.toggle", title: "Toggle command palette", run: () => setPaletteOpen((o) => !o) },
      { id: "pane.new-shell", title: "New shell pane", hint: "mod+t", run: newShell },
      { id: "pane.next", title: "Next pane", hint: "mod+]", run: () => cyclePane(1) },
      { id: "pane.prev", title: "Previous pane", hint: "mod+[", run: () => cyclePane(-1) },
      {
        id: "pane.close",
        title: "Close active pane",
        hint: "mod+w",
        run: () => {
          if (panes.length > 1) closePane(activePaneId);
        },
      },
      {
        id: "search.reindex",
        title: "Reindex this project for search",
        keywords: "search index",
        run: () => {
          if (dir) void reindex(dir);
        },
      },
      { id: "view.zoom-in", title: "Zoom in", hint: "mod+=", run: () => setFontSize((s) => Math.min(28, s + 1)) },
      { id: "view.zoom-out", title: "Zoom out", hint: "mod+-", run: () => setFontSize((s) => Math.max(8, s - 1)) },
      { id: "view.zoom-reset", title: "Reset zoom", hint: "mod+0", run: () => setFontSize(13) },
      { id: "terminal.search", title: "Find in terminal", hint: "mod+f", run: () => setSearchOpen(true) },
      {
        id: "terminal.copy-on-select",
        title: copyOnSelect ? "Copy on select: off" : "Copy on select: on",
        keywords: "clipboard selection",
        run: () => setCopyOnSelect((c) => !c),
      },
      { id: "keybindings.open", title: "Edit keybindings…", run: () => setKeybindingsOpen(true) },
      { id: "prompts.open", title: "Prompt library…", keywords: "slash command template", run: () => setPromptsOpen(true) },
      { id: "devices.pair", title: "Pair a device…", keywords: "remote mobile cockpit phone", run: () => setPairingOpen(true) },
      {
        id: "notifications.quiet",
        title: quiet ? "Notifications: unmute" : "Notifications: quiet mode",
        keywords: "mute notifications",
        run: () =>
          setQuiet((q) => {
            const next = !q;
            localStorage.setItem("glaude.quiet", next ? "1" : "0");
            return next;
          }),
      },
    ],
    [panes, activePaneId, dir, quiet, copyOnSelect],
  );
  commandsRef.current = commands;

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
          width={sidebarW}
        />
        <Splitter value={sidebarW} min={180} max={520} sign={1} onChange={setSidebarW} />
        <Workspace
          panes={panes}
          activePaneId={activePaneId}
          onSelectPane={selectPane}
          onClosePane={closePane}
          onNewShell={newShell}
          onNewClaude={newClaude}
          onHandoff={onHandoff}
          canCreateSession={!!dir}
          fontSize={fontSize}
          searchOpen={searchOpen}
          onCloseSearch={() => setSearchOpen(false)}
          copyOnSelect={copyOnSelect}
        />
        <Splitter value={dockW} min={240} max={600} sign={-1} onChange={setDockW} />
        <RightDock dir={inspect?.dir ?? null} selectedId={inspect?.sessionId ?? null} width={dockW} />
      </div>
      <ApprovalPanel dir={dir} />
      <NotificationService
        liveSessions={liveSessions}
        projectDir={dir}
        quiet={quiet}
        onSelectSession={selectSession}
      />
      <CommandPalette
        open={paletteOpen}
        commands={commands}
        dir={dir}
        onClose={() => setPaletteOpen(false)}
        onSelectSession={selectSession}
      />
      {keybindingsOpen && (
        <KeybindingsModal
          commands={commands.map((c) => ({ id: c.id, title: c.title }))}
          onClose={() => setKeybindingsOpen(false)}
          onChanged={(km) => setKeymap(km)}
        />
      )}
      {promptsOpen && (
        <PromptsModal
          dir={dir}
          onClose={() => setPromptsOpen(false)}
          onInsert={(text) => void invoke("pty_write", { paneId: activePaneId, data: text })}
        />
      )}
      {pairingOpen && <PairingModal onClose={() => setPairingOpen(false)} />}
      <StatusBar
        dir={inspect?.dir ?? null}
        selectedId={inspect?.sessionId ?? null}
        projectDir={dir}
        liveSessions={liveSessions}
      />
    </div>
  );
}
