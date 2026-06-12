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
import { ResumeBanner } from "./ResumeBanner";
import { TERMINAL_THEMES, THEME_NAMES, DEFAULT_THEME } from "./terminalThemes";
import { matchEvent } from "./keybindings";
import {
  createWorktree,
  getKeybindings,
  handoff,
  listSessions,
  projectDir,
  reindex,
  type Keybinding,
  type SessionSummary,
} from "./engine";
import "./App.css";

const INITIAL_PANES: Pane[] = [{ paneId: "main", kind: "shell", title: "Shell" }];

const num = (v: string | null, fallback: number) => {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};

/** Normalise a session's lastModified (epoch number | Date | ISO string) to millis. */
const sessionTs = (s: SessionSummary): number => {
  const v: unknown = s.lastModified;
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  const n = Date.parse(String(v));
  return Number.isNaN(n) ? 0 : n;
};

export default function App() {
  const [dir, setDir] = useState<string | null>(null);
  const [panes, setPanes] = useState<Pane[]>(INITIAL_PANES);
  const [activePaneId, setActivePaneId] = useState<string>("main");
  // A stale session selected in the sidebar but not yet resumed — drives the resume preview
  // banner (V4-A3). Cleared on resume, on switching to a live pane, or on dismiss.
  const [preview, setPreview] = useState<{ id: string; cwd?: string; title?: string } | null>(null);
  // Live cwd per pane, from OSC 7 — lets the sidebar/dock follow where you're actually working
  // (e.g. you `cd` into another project in a shell). Keyed by paneId.
  const [paneCwds, setPaneCwds] = useState<Record<string, string>>({});
  // Second pane shown side-by-side with the active one (V3-E1). null = single (tabs).
  const [splitPaneId, setSplitPaneId] = useState<string | null>(null);
  // The right dock + status bar reflect ONLY the active pane: a Claude pane → its live
  // session; a Shell pane → nothing. Sidebar/search clicks switch to (or resume) a session
  // as a real pane — they never repurpose the dock over stale historical data.
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("glaude.sidebarCollapsed") === "1");
  const [dockCollapsed, setDockCollapsed] = useState(() => localStorage.getItem("glaude.dockCollapsed") === "1");
  const [zen, setZen] = useState(false);
  useEffect(() => localStorage.setItem("glaude.sidebarCollapsed", sidebarCollapsed ? "1" : "0"), [sidebarCollapsed]);
  useEffect(() => localStorage.setItem("glaude.dockCollapsed", dockCollapsed ? "1" : "0"), [dockCollapsed]);
  const [copyOnSelect, setCopyOnSelect] = useState(() => localStorage.getItem("glaude.copyOnSelect") === "1");
  useEffect(() => localStorage.setItem("glaude.copyOnSelect", copyOnSelect ? "1" : "0"), [copyOnSelect]);
  const [cursorStyle, setCursorStyle] = useState<"block" | "bar" | "underline">(
    () => (localStorage.getItem("glaude.cursorStyle") as any) || "block",
  );
  const [cursorBlink, setCursorBlink] = useState(() => localStorage.getItem("glaude.cursorBlink") !== "0");
  useEffect(() => localStorage.setItem("glaude.cursorStyle", cursorStyle), [cursorStyle]);
  useEffect(() => localStorage.setItem("glaude.cursorBlink", cursorBlink ? "1" : "0"), [cursorBlink]);
  const [themeName, setThemeName] = useState(() => {
    const saved = localStorage.getItem("glaude.theme");
    return saved && THEME_NAMES.includes(saved) ? saved : DEFAULT_THEME;
  });
  useEffect(() => localStorage.setItem("glaude.theme", themeName), [themeName]);
  useEffect(() => localStorage.setItem("glaude.sidebarW", String(sidebarW)), [sidebarW]);
  useEffect(() => localStorage.setItem("glaude.dockW", String(dockW)), [dockW]);
  // Width (px) of the active/left pane when split (V4-C1/C2). The right pane flexes to fill the
  // rest. We persist the WIDTH (a reusable preference), not splitPaneId — panes are ephemeral.
  const [splitW, setSplitW] = useState(() => num(localStorage.getItem("glaude.splitW"), 480));
  useEffect(() => localStorage.setItem("glaude.splitW", String(splitW)), [splitW]);

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
      // Don't hijack chords while the user is typing in a text field (rename box, search,
      // commit message, etc.) — let the input handle them (V4-E1). The xterm textarea is
      // exempt: terminal keybindings (Cmd-F, Cmd-1..9) must still work while it's focused.
      const el = document.activeElement as HTMLElement | null;
      if (el) {
        const tag = el.tagName;
        const editable =
          tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
        const inTerminal = !!el.closest(".terminal-host");
        if (editable && !inTerminal) return;
      }
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

  // The dock + status bar reflect ONLY the active pane. A Claude pane → its live session;
  // a Shell pane → null (the dock shows its empty/guide state, never stale history).
  const inspected = useMemo(() => {
    const p = panes.find((x) => x.paneId === activePaneId);
    return p?.kind === "claude" && p.sessionId ? { sessionId: p.sessionId, dir: p.cwd ?? dir ?? "" } : null;
  }, [panes, activePaneId, dir]);

  // The active pane's effective working directory — its live OSC-7 cwd if known, else its spawn
  // cwd, else the launch project. The sidebar follows THIS, so `cd`-ing into another project in a
  // shell surfaces that project's sessions instead of always the launch project's.
  const activeCwd = useMemo(() => {
    const p = panes.find((x) => x.paneId === activePaneId);
    return paneCwds[activePaneId] ?? p?.cwd ?? dir;
  }, [paneCwds, activePaneId, panes, dir]);

  // Detect a Claude session running inside the active *Shell* pane (a `claude` the user started
  // by hand, not via "+ Claude"). We can't know its id directly, so infer it: poll the active
  // cwd's sessions and take the most-recently-modified one IF it changed in the last ~2 min
  // (i.e. it's actively live). This binds the dock to a session GlaudeCode didn't spawn.
  const [inferred, setInferred] = useState<{ sessionId: string; dir: string } | null>(null);
  useEffect(() => {
    const p = panes.find((x) => x.paneId === activePaneId);
    // Claude panes already bind via `inspected`; only infer for non-Claude (shell) panes.
    if (!activeCwd || p?.kind === "claude") {
      setInferred(null);
      return;
    }
    let alive = true;
    let locked: string | null = null; // sticky: the session id we've locked onto for this cwd
    const LIVE_WINDOW = 2 * 60 * 1000;
    setInferred(null); // reset when (re)entering a shell pane / new cwd
    const tick = async () => {
      try {
        const sessions = await listSessions(activeCwd);
        if (!alive) return;
        let best: { s: SessionSummary; t: number } | null = null;
        for (const s of sessions) {
          const t = sessionTs(s);
          if (t > (best?.t ?? -1)) best = { s, t };
        }
        // Lock onto the newest session that's been live recently. Once locked, stay on it even
        // as it idles (sticky) — only switch if a different, newer-recent session appears.
        if (best && Date.now() - best.t < LIVE_WINDOW && best.s.id !== locked) {
          locked = best.s.id;
          setInferred({ sessionId: best.s.id, dir: activeCwd });
        }
      } catch {
        /* leave the current inference in place on a transient read error */
      }
    };
    void tick();
    const iv = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [activePaneId, activeCwd, panes]);

  // What the dock + status bar inspect: the active Claude pane's session, else a session inferred
  // as live in the active shell pane.
  const docked = inspected ?? inferred;

  const selectPane = (paneId: string) => setActivePaneId(paneId);

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
  };

  const closePane = (paneId: string) => {
    const target = panes.find((p) => p.paneId === paneId);
    if (target?.kind === "claude" && !confirm(`Close "${target.title}"? Its Claude session will be terminated.`)) {
      return;
    }
    if (paneId === splitPaneId) setSplitPaneId(null);
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

  // Selecting a stale session in the sidebar/search shows a resume PREVIEW (recap + suggested
  // next) before spawning anything (V4-A3). If a live pane already hosts the session we just
  // switch to it — no preview, since you're already in it.
  const selectSession = (id: string, cwd?: string, title?: string) => {
    const live = panes.find((p) => p.kind === "claude" && p.sessionId === id);
    if (live) {
      setActivePaneId(live.paneId);
      setPreview(null);
      return;
    }
    setPreview({ id, cwd, title });
  };

  // Clicking a session in the sidebar/search switches to its live pane if one is open,
  // otherwise resumes it as a new Claude pane (`claude --resume <id>`) in its own cwd. The
  // dock then binds to that active pane — clicks never just repurpose the dock.
  const openSession = (id: string, cwd?: string, title?: string) => {
    const live = panes.find((p) => p.kind === "claude" && p.sessionId === id);
    if (live) {
      setActivePaneId(live.paneId);
      return;
    }
    const paneCwd = cwd || dir || undefined;
    const pane: Pane = {
      paneId: id,
      kind: "claude",
      title: title || id.slice(0, 8),
      cwd: paneCwd,
      worktreePath: paneCwd,
      cmd: "claude",
      args: ["--resume", id],
      sessionId: id,
    };
    setPanes((ps) => (ps.some((p) => p.paneId === id) ? ps : [...ps, pane]));
    setActivePaneId(id);
    setPreview(null);
  };

  // Toggle a 2-pane side-by-side split (V3-E1). Secondary = next pane, or a fresh shell.
  const toggleSplit = () => {
    if (splitPaneId) {
      setSplitPaneId(null);
      return;
    }
    const other = panes.find((p) => p.paneId !== activePaneId);
    if (other) {
      setSplitPaneId(other.paneId);
      return;
    }
    const id = crypto.randomUUID();
    setPanes((ps) => [...ps, { paneId: id, kind: "shell", title: "Shell", cwd: dir ?? undefined }]);
    setSplitPaneId(id);
  };

  const reorderPanes = (from: number, to: number) => {
    setPanes((ps) => {
      if (from < 0 || from >= ps.length || to < 0 || to >= ps.length) return ps;
      const next = [...ps];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
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
      { id: "pane.split", title: splitPaneId ? "Unsplit" : "Split right", hint: "mod+d", run: toggleSplit },
      ...Array.from({ length: 9 }, (_, i) => ({
        id: `pane.go-${i + 1}`,
        title: `Switch to pane ${i + 1}`,
        hint: `mod+${i + 1}`,
        run: () => {
          const p = panes[i];
          if (p) selectPane(p.paneId);
        },
      })),
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
      {
        id: "terminal.cursor-style",
        title: `Cursor style: ${cursorStyle} →`,
        keywords: "block bar underline",
        run: () => setCursorStyle((s) => (s === "block" ? "bar" : s === "bar" ? "underline" : "block")),
      },
      {
        id: "terminal.cursor-blink",
        title: cursorBlink ? "Cursor blink: off" : "Cursor blink: on",
        run: () => setCursorBlink((b) => !b),
      },
      {
        id: "terminal.theme",
        title: `Terminal theme: ${themeName} →`,
        keywords: "color scheme light dark solarized",
        run: () => setThemeName((t) => THEME_NAMES[(THEME_NAMES.indexOf(t) + 1) % THEME_NAMES.length]),
      },
      {
        id: "view.toggle-sidebar",
        title: sidebarCollapsed ? "Show sidebar" : "Hide sidebar",
        hint: "mod+b",
        run: () => setSidebarCollapsed((c) => !c),
      },
      {
        id: "view.toggle-dock",
        title: dockCollapsed ? "Show right dock" : "Hide right dock",
        hint: "mod+shift+b",
        run: () => setDockCollapsed((c) => !c),
      },
      {
        id: "view.zen",
        title: zen ? "Exit zen mode" : "Zen mode (hide all chrome)",
        hint: "mod+shift+enter",
        run: () => setZen((z) => !z),
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
    [panes, activePaneId, splitPaneId, dir, quiet, copyOnSelect, cursorStyle, cursorBlink, themeName, sidebarCollapsed, dockCollapsed, zen],
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
  };

  return (
    <div className="app-root">
      {preview && (
        <ResumeBanner
          dir={preview.cwd ?? dir}
          sessionId={preview.id}
          onResume={() => openSession(preview.id, preview.cwd, preview.title)}
          onDismiss={() => setPreview(null)}
        />
      )}
      <div className="app-shell">
        {!zen && !sidebarCollapsed && (
          <Sidebar
            dir={activeCwd}
            selectedId={preview?.id ?? inspected?.sessionId ?? null}
            onSelect={selectSession}
            liveSessionIds={liveSessionIds}
            width={sidebarW}
          />
        )}
        {!zen && !sidebarCollapsed && (
          <Splitter
            value={sidebarW}
            min={180}
            max={520}
            sign={1}
            onChange={setSidebarW}
            onDoubleClick={() => setSidebarCollapsed(true)}
          />
        )}
        <Workspace
          panes={panes}
          activePaneId={activePaneId}
          splitPaneId={splitPaneId}
          splitW={splitW}
          onSplitResize={setSplitW}
          onSelectPane={selectPane}
          onClosePane={closePane}
          onNewShell={newShell}
          onNewClaude={newClaude}
          onHandoff={onHandoff}
          onReorder={reorderPanes}
          canCreateSession={!!dir}
          fontSize={fontSize}
          searchOpen={searchOpen}
          onCloseSearch={() => setSearchOpen(false)}
          copyOnSelect={copyOnSelect}
          cursorStyle={cursorStyle}
          cursorBlink={cursorBlink}
          theme={TERMINAL_THEMES[themeName]}
          onPaneCwd={(paneId, cwd) => setPaneCwds((m) => (m[paneId] === cwd ? m : { ...m, [paneId]: cwd }))}
        />
        {!zen && !dockCollapsed && (
          <Splitter
            value={dockW}
            min={240}
            max={600}
            sign={-1}
            onChange={setDockW}
            onDoubleClick={() => setDockCollapsed(true)}
          />
        )}
        {!zen && !dockCollapsed && (
          <RightDock
            dir={docked?.dir ?? null}
            selectedId={docked?.sessionId ?? null}
            projectDir={dir}
            inferred={!inspected && !!inferred}
            width={dockW}
          />
        )}
      </div>
      <ApprovalPanel dir={dir} />
      <NotificationService
        liveSessions={liveSessions}
        projectDir={dir}
        quiet={quiet}
        onSelectSession={(id) => openSession(id)}
      />
      <CommandPalette
        open={paletteOpen}
        commands={commands}
        dir={dir}
        onClose={() => setPaletteOpen(false)}
        onSelectSession={(id) => openSession(id)}
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
          activeIsClaude={panes.find((p) => p.paneId === activePaneId)?.kind === "claude"}
          onInsert={(text) => {
            // Guard in case the active pane changed while the modal was open (V4-E3).
            if (panes.find((p) => p.paneId === activePaneId)?.kind !== "claude") return;
            void invoke("pty_write", { paneId: activePaneId, data: text });
          }}
        />
      )}
      {pairingOpen && <PairingModal onClose={() => setPairingOpen(false)} />}
      {!zen && (
        <StatusBar
          dir={docked?.dir ?? null}
          selectedId={docked?.sessionId ?? null}
          projectDir={dir}
          liveSessions={liveSessions}
        />
      )}
    </div>
  );
}
