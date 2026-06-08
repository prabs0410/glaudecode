import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { projectDir } from "./engine";
import "./App.css";

function TerminalPane() {
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
    const unlistenOut = listen<number[]>("pty-output", (e) => {
      term.write(decoder.decode(new Uint8Array(e.payload), { stream: true }));
    });
    const unlistenExit = listen("pty-exit", () => {
      term.write("\r\n\x1b[90m[process exited]\x1b[0m\r\n");
    });

    invoke("pty_spawn", { rows: term.rows, cols: term.cols });
    term.onData((d) => void invoke("pty_write", { data: d }));

    const refit = () => {
      fit.fit();
      void invoke("pty_resize", { rows: term.rows, cols: term.cols });
    };
    const ro = new ResizeObserver(refit);
    ro.observe(hostRef.current);

    return () => {
      ro.disconnect();
      unlistenOut.then((f) => f());
      unlistenExit.then((f) => f());
      term.dispose();
    };
  }, []);

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
        <TerminalPane />
      </div>
      <StatusBar dir={dir} selectedId={selectedId} />
    </div>
  );
}
