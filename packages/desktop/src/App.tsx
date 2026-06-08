import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { RightDock } from "./RightDock";
import { projectDir } from "./engine";
import "./App.css";

interface TerminalPaneProps {
  /** Opaque id binding this xterm instance to one PTY in the Rust registry. */
  paneId: string;
  /** Working directory for the spawned process (defaults to the app cwd). */
  cwd?: string;
  /** Program to run; omit for an interactive login shell. */
  cmd?: string;
  /** Arguments for `cmd` (e.g. ["--session-id", uuid] for a Claude pane). */
  args?: string[];
}

function TerminalPane({ paneId, cwd, cmd, args }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false); // guard against double-spawn

  useEffect(() => {
    if (!hostRef.current || startedRef.current) return;
    startedRef.current = true;

    const term = new Terminal({
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13,
      cursorBlink: true,
      theme: { background: "#0d1117", foreground: "#c9d1d9" },
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // WebGL unavailable → xterm falls back to canvas. Fine.
    }
    fit.fit();
    term.focus();

    const decoder = new TextDecoder();
    const unlistenOut = listen<number[]>(`pty-output:${paneId}`, (e) => {
      term.write(decoder.decode(new Uint8Array(e.payload), { stream: true }));
    });
    const unlistenExit = listen(`pty-exit:${paneId}`, () => {
      term.write("\r\n\x1b[90m[process exited]\x1b[0m\r\n");
    });

    invoke("pty_spawn", { paneId, cwd, cmd, args, rows: term.rows, cols: term.cols });
    term.onData((d) => void invoke("pty_write", { paneId, data: d }));

    const refit = () => {
      fit.fit();
      void invoke("pty_resize", { paneId, rows: term.rows, cols: term.cols });
    };
    const ro = new ResizeObserver(refit);
    ro.observe(hostRef.current);

    return () => {
      ro.disconnect();
      unlistenOut.then((f) => f());
      unlistenExit.then((f) => f());
      void invoke("pty_kill", { paneId });
      term.dispose();
    };
  }, [paneId, cwd, cmd, args]);

  return <div ref={hostRef} className="terminal-host" />;
}

export default function App() {
  const [dir, setDir] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    projectDir()
      .then(setDir)
      .catch(() => setDir(null));
  }, []);

  return (
    <div className="app-root">
      <div className="app-shell">
        <Sidebar dir={dir} selectedId={selectedId} onSelect={setSelectedId} />
        <TerminalPane paneId="main" />
        <RightDock dir={dir} selectedId={selectedId} />
      </div>
      <StatusBar dir={dir} selectedId={selectedId} />
    </div>
  );
}
