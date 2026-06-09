import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { listen } from "@tauri-apps/api/event";
import type { ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

const IS_MAC = typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent || "");

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
  /** Show the in-terminal search bar (only the active pane, when search is toggled). */
  searchActive?: boolean;
  /** Called when the user closes the search bar (Esc / ✕). */
  onCloseSearch?: () => void;
  /** Auto-copy the selection to the clipboard when you select text. */
  copyOnSelect?: boolean;
  cursorStyle?: "block" | "bar" | "underline";
  cursorBlink?: boolean;
  theme?: ITheme;
}

const DARK_BG = "#0d1117";

// One xterm.js terminal bound to one Rust-side PTY (Epic A). Spawn parameters are
// fixed for a pane's lifetime, so the effect runs once per paneId; on unmount it
// kills the PTY. Many of these mount at once (one per tab) — only the active one is
// visible, but all keep buffering their own `pty-output:{paneId}` stream.
export function TerminalPane({
  paneId,
  cwd,
  cmd,
  args,
  fontSize = 13,
  searchActive = false,
  onCloseSearch,
  copyOnSelect = false,
  cursorStyle = "block",
  cursorBlink = true,
  theme,
}: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false); // guard against double-spawn (React strict/dev)
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const copyOnSelectRef = useRef(copyOnSelect);
  copyOnSelectRef.current = copyOnSelect;

  // Apply font-size changes live and tell the PTY the new dimensions.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = fontSize;
    fitRef.current?.fit();
    void invoke("pty_resize", { paneId, rows: term.rows, cols: term.cols });
  }, [fontSize, paneId]);

  // Apply cursor style / blink live.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.cursorStyle = cursorStyle;
    term.options.cursorBlink = cursorBlink;
  }, [cursorStyle, cursorBlink]);

  // Apply theme live; keep the host padding background in sync (so light themes don't
  // show a dark border).
  useEffect(() => {
    const term = termRef.current;
    if (!term || !theme) return;
    term.options.theme = theme;
    if (hostRef.current) hostRef.current.style.background = theme.background ?? DARK_BG;
  }, [theme]);

  useEffect(() => {
    if (!hostRef.current || startedRef.current) return;
    startedRef.current = true;

    const term = new Terminal({
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize,
      cursorBlink,
      cursorStyle,
      theme: theme ?? { background: DARK_BG, foreground: "#c9d1d9" },
      allowProposedApi: true,
    });
    if (hostRef.current && theme?.background) hostRef.current.style.background = theme.background;
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
    const search = new SearchAddon();
    term.loadAddon(search);
    searchRef.current = search;

    // Copy/paste: Cmd/Ctrl-C copies the selection (Ctrl-C with no selection still goes to
    // the PTY as SIGINT); Cmd/Ctrl-V pastes via bracketed paste so multiline content arrives
    // as one block and won't auto-execute.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const mod = IS_MAC ? e.metaKey : e.ctrlKey;
      if (mod && e.key.toLowerCase() === "c" && term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection()).catch(() => {});
        return false;
      }
      if (mod && e.key.toLowerCase() === "v") {
        void navigator.clipboard
          .readText()
          .then((t) => t && invoke("pty_write", { paneId, data: `\x1b[200~${t}\x1b[201~` }))
          .catch(() => {});
        return false;
      }
      return true;
    });
    term.onSelectionChange(() => {
      if (copyOnSelectRef.current && term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection()).catch(() => {});
      }
    });
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

  return (
    <div className="terminal-pane">
      <div ref={hostRef} className="terminal-host" />
      {searchActive && (
        <TerminalSearchBar
          onFind={(q, prev) => {
            const opts = { decorations: { matchOverviewRuler: "#d29922", activeMatchColorOverviewRuler: "#e3b341" } } as any;
            if (prev) searchRef.current?.findPrevious(q, opts);
            else searchRef.current?.findNext(q, opts);
          }}
          onClose={() => {
            searchRef.current?.clearDecorations();
            onCloseSearch?.();
          }}
        />
      )}
    </div>
  );
}

function TerminalSearchBar({
  onFind,
  onClose,
}: {
  onFind: (query: string, prev: boolean) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  return (
    <div className="term-search">
      <input
        ref={inputRef}
        className="term-search-input"
        placeholder="Find in terminal…"
        value={q}
        onChange={(e) => {
          setQ(e.currentTarget.value);
          onFind(e.currentTarget.value, false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") onFind(q, e.shiftKey);
          if (e.key === "Escape") onClose();
        }}
        spellCheck={false}
      />
      <button className="act mini" title="Previous (Shift+Enter)" onClick={() => onFind(q, true)}>↑</button>
      <button className="act mini" title="Next (Enter)" onClick={() => onFind(q, false)}>↓</button>
      <button className="act mini" title="Close (Esc)" onClick={onClose}>✕</button>
    </div>
  );
}
