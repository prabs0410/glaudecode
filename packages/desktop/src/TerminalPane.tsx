import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { invoke } from "@tauri-apps/api/core";
import { openUrl, openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { parseOsc133, parseOsc7 } from "./osc";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

/**
 * Remove every bracketed-paste marker from clipboard text before we wrap it (audit H4). A SINGLE
 * replace pass is bypassable: deleting an inner \x1b[201~ can splice its neighbours into a fresh
 * marker, so we loop to a FIXPOINT — afterwards the string provably contains no 200~/201~ marker and
 * the wrapped paste can't be broken out of. Mirrors the engine's wrapForPaste scrub.
 */
function scrubPasteMarkers(text: string): string {
  let clean = text;
  let prev: string;
  do {
    prev = clean;
    clean = clean.replace(/\x1b\[20[01]~/g, "");
  } while (clean !== prev);
  return clean;
}

const IS_MAC = typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent || "");

// Terminal output is UNTRUSTED — a process can print a path to an executable/script/bundle
// (.app/.command/.sh/.exe/…). Only OS-open files whose extension is on this safe allowlist
// (which never executes); anything else is merely revealed in the file manager.
const SAFE_OPEN_EXTS = new Set([
  "txt", "md", "markdown", "log", "json", "jsonc", "yaml", "yml", "toml", "ini", "cfg", "conf",
  "csv", "tsv", "xml", "html", "htm", "css", "scss", "less", "svg",
  // Source files — opened in an editor, not executed. Deliberately NO script/executable
  // types (.sh/.command/.ps1/.bat/.app/.exe/.jar/…): those are never auto-opened.
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "rs", "go", "py", "rb", "java", "kt", "kts", "swift",
  "c", "h", "cpp", "cc", "hpp", "cs", "php", "lua", "sql", "graphql", "proto",
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "pdf",
]);

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
  const m = Math.floor(ms / 60000);
  return `${m}m ${Math.round((ms % 60000) / 1000)}s`;
}

/** Compact a cwd for the chip: keep the last two path segments (full path is in the tooltip). */
function shortCwd(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length > 2 ? "…/" + parts.slice(-2).join("/") : path;
}

/** Resolve a path matched in terminal output and open it SAFELY (allowlisted extensions
 *  open in the default app; everything else is only revealed, never executed). */
function openFilePath(raw: string, cwd?: string) {
  const path = raw.replace(/:\d+(?::\d+)?$/, ""); // strip :line:col
  let abs = path;
  if (!path.startsWith("/") && !path.startsWith("~/")) {
    if (!cwd) return; // can't resolve a relative path without a cwd
    abs = `${cwd.replace(/\/$/, "")}/${path.replace(/^\.\//, "")}`;
  }
  const ext = (abs.split("/").pop() ?? "").split(".").pop()?.toLowerCase() ?? "";
  if (SAFE_OPEN_EXTS.has(ext)) void openPath(abs).catch(() => {});
  else void revealItemInDir(abs).catch(() => {}); // never auto-execute an unknown/executable type
}

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
  /** Reports the pane's live working directory (from OSC 7) so the app can follow it. */
  onCwd?: (cwd: string) => void;
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
  onCwd,
}: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false); // guard against double-spawn (React strict/dev)
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const copyOnSelectRef = useRef(copyOnSelect);
  copyOnSelectRef.current = copyOnSelect;
  // onCwd in a ref so the once-per-pane effect always calls the latest callback.
  const onCwdRef = useRef(onCwd);
  onCwdRef.current = onCwd;
  // Shell-integration (OSC 133/7) state: last command's timing/exit + the live cwd.
  const cmdStartRef = useRef<number | null>(null);
  const liveCwdRef = useRef<string | undefined>(cwd);
  const [lastCmd, setLastCmd] = useState<{ ms: number; exit?: number } | null>(null);
  // Live cwd from OSC 7 (V4-C3). The ref feeds the link resolver synchronously; the state drives
  // the cwd chip. Only shells with our integration emit OSC 7, so this stays empty otherwise.
  const [liveCwd, setLiveCwd] = useState<string | undefined>(undefined);

  // Apply font-size changes live and tell the PTY the new dimensions.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = fontSize;
    fitRef.current?.fit();
    // .catch: on mount this can fire before the (async) pty_spawn registers the pane — a harmless
    // "no such pane" until then; the spawn effect re-syncs the real size once the pane exists.
    void invoke("pty_resize", { paneId, rows: term.rows, cols: term.cols }).catch(() => {});
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
      scrollback: 5000,
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
    // Unicode 11 widths so emoji / wide CJK chars don't desync the cursor.
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";

    // Clickable file paths → open in the OS default app. Absolute paths are exact; relative
    // ones resolve against the pane's cwd (best-effort — exact live-cwd tracking is OSC 7, E2).
    term.registerLinkProvider({
      provideLinks(lineNumber, callback) {
        const line = term.buffer.active.getLine(lineNumber - 1)?.translateToString(true) ?? "";
        const links: any[] = [];
        const re = /(?:[\w.~@+-]*\/)+[\w.+-]+\.\w+(?::\d+(?::\d+)?)?/g;
        for (let m = re.exec(line); m; m = re.exec(line)) {
          const raw = m[0];
          const start = m.index;
          links.push({
            range: { start: { x: start + 1, y: lineNumber }, end: { x: start + raw.length, y: lineNumber } },
            text: raw,
            activate: () => openFilePath(raw, liveCwdRef.current),
          });
        }
        callback(links.length ? links : undefined);
      },
    });

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
          // Strip any bracketed-paste markers inside the clipboard before wrapping, so a copied
          // \x1b[201~ can't end the paste early and run the rest as live keystrokes (audit H4).
          .then((t) => t && invoke("pty_write", { paneId, data: `\x1b[200~${scrubPasteMarkers(t)}\x1b[201~` }))
          .catch(() => {});
        return false;
      }
      return true;
    });
    // Copy-on-select fires on a real pointer release, NOT on every selection change — otherwise
    // the SearchAddon's programmatic highlight selection would clobber the clipboard (V4-E4).
    const onMouseUp = () => {
      if (copyOnSelectRef.current && term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection()).catch(() => {});
      }
    };
    hostRef.current.addEventListener("mouseup", onMouseUp);
    // Shell integration: command markers (duration + exit code) and live cwd (V3-E2).
    term.parser.registerOscHandler(133, (data) => {
      const ev = parseOsc133(data);
      if (ev.kind === "pre-exec") cmdStartRef.current = Date.now();
      else if (ev.kind === "command-done" && cmdStartRef.current !== null) {
        setLastCmd({ ms: Date.now() - cmdStartRef.current, exit: ev.exitCode });
        cmdStartRef.current = null;
      }
      return true;
    });
    term.parser.registerOscHandler(7, (data) => {
      const p = parseOsc7(data);
      if (p) {
        liveCwdRef.current = p;
        setLiveCwd(p);
        onCwdRef.current?.(p);
      }
      return true;
    });

    // Visual bell: flash the pane on BEL instead of an audible beep.
    term.onBell(() => {
      const el = hostRef.current;
      if (!el) return;
      el.classList.add("bell-flash");
      setTimeout(() => el.classList.remove("bell-flash"), 130);
    });
    fit.fit();
    term.focus();

    const decoder = new TextDecoder();
    // Attach BOTH event listeners BEFORE spawning the PTY (V4-E2). listen() is async — if we
    // spawned first, the shell banner / a fast first command could emit before the listener
    // attached and be lost. `disposed` guards a teardown that races the async setup.
    let disposed = false;
    let spawned = false; // guard: don't write/resize a pane that doesn't exist yet (avoids the
    // "no such pane" rejection when the ResizeObserver fires before pty_spawn resolves).
    let unlistenOut: UnlistenFn | undefined;
    let unlistenExit: UnlistenFn | undefined;
    void (async () => {
      const [uo, ue] = await Promise.all([
        listen<number[]>(`pty-output:${paneId}`, (e) => {
          term.write(decoder.decode(new Uint8Array(e.payload), { stream: true }));
        }),
        listen(`pty-exit:${paneId}`, () => {
          term.write("\r\n\x1b[90m[process exited]\x1b[0m\r\n");
        }),
      ]);
      if (disposed) {
        uo();
        ue();
        return;
      }
      unlistenOut = uo;
      unlistenExit = ue;
      await invoke("pty_spawn", { paneId, cwd, cmd, args, rows: term.rows, cols: term.cols });
      spawned = true;
      // Sync the real PTY size now that the pane exists (an earlier resize was a no-op).
      void invoke("pty_resize", { paneId, rows: term.rows, cols: term.cols }).catch(() => {});
    })();
    term.onData((d) => {
      if (spawned) void invoke("pty_write", { paneId, data: d }).catch(() => {});
    });

    const refit = () => {
      fit.fit();
      if (spawned) void invoke("pty_resize", { paneId, rows: term.rows, cols: term.cols }).catch(() => {});
    };
    const ro = new ResizeObserver(refit);
    ro.observe(hostRef.current);

    return () => {
      disposed = true;
      ro.disconnect();
      hostRef.current?.removeEventListener("mouseup", onMouseUp);
      unlistenOut?.();
      unlistenExit?.();
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
      {liveCwd && (
        <div className="cwd-chip" title={liveCwd}>
          {shortCwd(liveCwd)}
        </div>
      )}
      {lastCmd && (
        <div className={`cmd-badge${lastCmd.exit ? " fail" : ""}`} title="Last command (duration · exit)">
          {lastCmd.exit ? "✗" : "✓"} {formatMs(lastCmd.ms)}
          {lastCmd.exit ? ` · exit ${lastCmd.exit}` : ""}
        </div>
      )}
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
