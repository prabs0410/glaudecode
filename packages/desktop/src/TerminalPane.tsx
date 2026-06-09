import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";

export interface TerminalPaneProps {
  /** Opaque id binding this xterm instance to one PTY in the Rust registry. */
  paneId: string;
  /** Working directory for the spawned process (defaults to the app cwd). */
  cwd?: string;
  /** Program to run; omit for an interactive login shell. */
  cmd?: string;
  /** Arguments for `cmd` (e.g. ["--session-id", uuid] for a Claude pane). */
  args?: string[];
  /** Shared font size (px); changes apply live and refit the pane. */
  fontSize?: number;
}

// One xterm.js terminal bound to one Rust-side PTY (Epic A). Spawn parameters are
// fixed for a pane's lifetime, so the effect runs once per paneId; on unmount it
// kills the PTY. Many of these mount at once (one per tab) — only the active one is
// visible, but all keep buffering their own `pty-output:{paneId}` stream.
export function TerminalPane({ paneId, cwd, cmd, args, fontSize = 13 }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false); // guard against double-spawn (React strict/dev)
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  // Apply font-size changes live and tell the PTY the new dimensions.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = fontSize;
    fitRef.current?.fit();
    void invoke("pty_resize", { paneId, rows: term.rows, cols: term.cols });
  }, [fontSize, paneId]);

  useEffect(() => {
    if (!hostRef.current || startedRef.current) return;
    startedRef.current = true;

    const term = new Terminal({
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize,
      cursorBlink: true,
      theme: { background: "#0d1117", foreground: "#c9d1d9" },
      allowProposedApi: true,
    });
    termRef.current = term;
    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    term.open(hostRef.current);
    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // WebGL unavailable → xterm falls back to canvas. Fine.
    }
    // Clickable URLs → open in the system browser (not inside the WebView).
    term.loadAddon(new WebLinksAddon((_e, uri) => void openUrl(uri)));
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
      termRef.current = null;
      fitRef.current = null;
    };
    // Spawn params are fixed per pane; only paneId identifies the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId]);

  return <div ref={hostRef} className="terminal-host" />;
}
