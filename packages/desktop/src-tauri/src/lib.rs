// GlaudeCode desktop core.
//
// Two responsibilities:
//   1. PTY bridge — run a real shell (and Claude Code) in the xterm.js pane.
//   2. Engine sidecar — spawn the host-agnostic @glaudecode/engine as a Bun child
//      process, read its {port, token} handshake, and expose the endpoint + the
//      project directory to the WebView. All Claude Code data flows through the
//      engine's RPC (Constitution Principle XI); the core never reads sessions.

use portable_pty::{native_pty_system, Child as PtyChild, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use tauri::{AppHandle, Emitter, Manager, State};

// ---------- PTY registry (Epic A — multi-session orchestration) ----------
//
// V1 ran a single PTY. V2 runs many: one pane per Claude Code session (each on
// its own git worktree) plus shell panes. The registry keys live PTYs by an
// opaque `paneId` minted by the WebView. Output/exit events are namespaced
// (`pty-output:{paneId}` / `pty-exit:{paneId}`) so each xterm instance only
// receives its own bytes. `cmd` lets a pane host the shell *or*
// `claude --session-id <uuid>` for deterministic pane↔session binding.

struct PaneHandle {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn PtyChild + Send + Sync>,
}

#[derive(Default)]
struct PtyRegistry {
    panes: Mutex<HashMap<String, PaneHandle>>,
}

// Vendored fish-like autosuggestions plugin (MIT — see NOTICE), embedded in the binary so
// it ships without resource-path plumbing and works in dev + prod alike.
const ZSH_AUTOSUGGESTIONS: &str = include_str!("../resources/shell/zsh-autosuggestions.zsh");
// zsh-syntax-highlighting (BSD — see NOTICE): loader + the default "main" highlighter. The
// loader resolves highlighters relative to itself and reads .version/.revision-hash, which we
// write at runtime.
const ZSH_SYNTAX_LOADER: &str =
    include_str!("../resources/shell/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh");
const ZSH_SYNTAX_MAIN: &str =
    include_str!("../resources/shell/zsh-syntax-highlighting/highlighters/main/main-highlighter.zsh");
const ZSH_SYNTAX_VERSION: &str = "0.8.0";

/// Write a ZDOTDIR wrapper under ~/.glaudecode/shell that sources the user's real zsh config
/// and then our autosuggestions plugin. Returns (wrapper_dir, real_zdotdir) on success.
/// The wrapper keeps ZDOTDIR pointed at itself only long enough to run our rc files, then
/// restores the user's real ZDOTDIR — so dotfiles that read $ZDOTDIR keep working.
fn setup_zsh_autosuggestions() -> Option<(String, String)> {
    let home = std::env::var("HOME").ok()?;
    let base = PathBuf::from(&home).join(".glaudecode").join("shell");
    let wrapper = base.join("zdotdir");
    std::fs::create_dir_all(&wrapper).ok()?;

    let plugin = base.join("zsh-autosuggestions.zsh");
    std::fs::write(&plugin, ZSH_AUTOSUGGESTIONS).ok()?;
    let wrapper_str = wrapper.to_string_lossy().into_owned();
    let plugin_str = plugin.to_string_lossy().into_owned();

    // zsh-syntax-highlighting: write the loader + main highlighter + version files.
    let syntax_dir = base.join("zsh-syntax-highlighting");
    std::fs::create_dir_all(syntax_dir.join("highlighters").join("main")).ok();
    std::fs::write(syntax_dir.join("zsh-syntax-highlighting.zsh"), ZSH_SYNTAX_LOADER).ok();
    std::fs::write(
        syntax_dir.join("highlighters").join("main").join("main-highlighter.zsh"),
        ZSH_SYNTAX_MAIN,
    )
    .ok();
    std::fs::write(syntax_dir.join(".version"), ZSH_SYNTAX_VERSION).ok();
    std::fs::write(syntax_dir.join(".revision-hash"), ZSH_SYNTAX_VERSION).ok();
    let syntax_str = syntax_dir.join("zsh-syntax-highlighting.zsh").to_string_lossy().into_owned();
    let dirhist_str = base.join("dirhist").to_string_lossy().into_owned();

    // Each wrapper file: point ZDOTDIR at the real dir, source the real counterpart, then
    // restore ZDOTDIR to the wrapper so zsh reads our next file too.
    let real_then_back = |real_file: &str| -> String {
        format!(
            "ZDOTDIR=\"${{_GLAUDE_REAL_ZDOTDIR:-$HOME}}\"\n[[ -f \"$ZDOTDIR/{f}\" ]] && source \"$ZDOTDIR/{f}\"\nZDOTDIR=\"{w}\"\n",
            f = real_file,
            w = wrapper_str
        )
    };
    std::fs::write(wrapper.join(".zshenv"), real_then_back(".zshenv")).ok()?;
    std::fs::write(wrapper.join(".zprofile"), real_then_back(".zprofile")).ok()?;

    // .zshrc: load the user's config, then the plugin, then bind smart-Tab — accept the
    // autosuggestion if one is shown, else fall through to whatever Tab was already bound to
    // (so frameworks like fzf-tab keep working). Finally restore the real ZDOTDIR. Written
    // from a raw-string template (with the plugin path substituted) to keep the zsh legible.
    let zshrc = r#"ZDOTDIR="${_GLAUDE_REAL_ZDOTDIR:-$HOME}"
[[ -f "$ZDOTDIR/.zshrc" ]] && source "$ZDOTDIR/.zshrc"
# Ensure shell history is loaded into the session so autosuggestions have data.
[[ -z "$HISTFILE" ]] && HISTFILE="${_GLAUDE_REAL_ZDOTDIR:-$HOME}/.zsh_history"
fc -R "$HISTFILE" 2>/dev/null || true
ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE='fg=8'
source "__GLAUDE_PLUGIN__"
# Directory-scoped suggestions: record cmd+cwd, and prefer this dir's history then global.
_GLAUDE_DIRHIST="__GLAUDE_DIRHIST__"
autoload -Uz add-zsh-hook
_glaude_record_dirhist() { print -r -- "${PWD}"$'\t'"$1" >> "$_GLAUDE_DIRHIST" 2>/dev/null }
add-zsh-hook preexec _glaude_record_dirhist
_zsh_autosuggest_strategy_glaude_dir() {
  emulate -L zsh
  local prefix="$1"
  [[ -z "$prefix" || ! -r "$_GLAUDE_DIRHIST" ]] && return
  local m
  m=$(tail -n 4000 "$_GLAUDE_DIRHIST" 2>/dev/null | awk -F'\t' -v d="$PWD" -v p="$prefix" '$1==d && index($2,p)==1 {last=$2} END {if (last!="") print last}')
  [[ -n "$m" ]] && typeset -g suggestion="$m"
}
ZSH_AUTOSUGGEST_STRATEGY=(glaude_dir history)
# OSC 133/7 shell integration: command markers (duration + exit code) and cwd, emitted with no
# visible output. The WebView parses these (V3-E2).
_glaude_osc_preexec() { print -n "\e]133;C\e\\" }
_glaude_osc_precmd() { local ec=$?; print -n "\e]133;D;${ec}\e\\"; print -n "\e]133;A\e\\"; print -n "\e]7;file://${HOST}${PWD}\e\\" }
add-zsh-hook preexec _glaude_osc_preexec
add-zsh-hook precmd _glaude_osc_precmd
# GlaudeCode smart Tab: accept the autosuggestion if shown, else the prior Tab behavior.
typeset -g _GLAUDE_ORIG_TAB="${$(bindkey '^I')##* }"
[[ -z "$_GLAUDE_ORIG_TAB" || "$_GLAUDE_ORIG_TAB" == "undefined-key" ]] && _GLAUDE_ORIG_TAB=expand-or-complete
_glaude_smart_tab() { if [[ -n "$POSTDISPLAY" ]]; then zle autosuggest-accept; else zle "$_GLAUDE_ORIG_TAB"; fi }
zle -N _glaude_smart_tab
bindkey '^I' _glaude_smart_tab
# Syntax highlighting must be sourced LAST so it wraps the final set of widgets.
source "__GLAUDE_SYNTAX__"
ZDOTDIR="${_GLAUDE_REAL_ZDOTDIR:-$HOME}"
"#
    .replace("__GLAUDE_PLUGIN__", &plugin_str)
    .replace("__GLAUDE_SYNTAX__", &syntax_str)
    .replace("__GLAUDE_DIRHIST__", &dirhist_str);
    std::fs::write(wrapper.join(".zshrc"), zshrc).ok()?;

    let real = std::env::var("ZDOTDIR").unwrap_or(home);
    Some((wrapper_str, real))
}

#[tauri::command]
fn pty_spawn(
    app: AppHandle,
    registry: State<PtyRegistry>,
    pane_id: String,
    cwd: Option<String>,
    cmd: Option<String>,
    args: Option<Vec<String>>,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    // One PTY per paneId. Refuse to clobber a live pane (the caller should
    // pick a fresh id, or kill first) so we never orphan a running child.
    if registry.panes.lock().unwrap().contains_key(&pane_id) {
        return Err(format!("pane already exists: {pane_id}"));
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    // `cmd` present → run it with `args` (e.g. `claude --session-id <uuid>`).
    // Absent → an interactive login shell.
    let mut builder = match &cmd {
        Some(program) => {
            let mut b = CommandBuilder::new(program);
            for a in args.unwrap_or_default() {
                b.arg(a);
            }
            b
        }
        None => {
            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
            let is_zsh =
                std::path::Path::new(&shell).file_name().and_then(|n| n.to_str()) == Some("zsh");
            let mut b = CommandBuilder::new(shell);
            b.arg("-l");
            // Fish-like command autosuggestions for zsh (from shell history), injected ONLY
            // into GlaudeCode's shells via a ZDOTDIR wrapper — the user's ~/.zshrc is never
            // modified. Best-effort: if setup fails, the shell just spawns without it.
            if is_zsh {
                if let Some((wrapper, real)) = setup_zsh_autosuggestions() {
                    b.env("ZDOTDIR", &wrapper);
                    b.env("_GLAUDE_REAL_ZDOTDIR", &real);
                }
            }
            b
        }
    };
    let workdir = cwd
        .map(PathBuf::from)
        .or_else(|| std::env::current_dir().ok());
    if let Some(dir) = workdir {
        builder.cwd(dir);
    }
    builder.env("TERM", "xterm-256color");
    // Mark PTYs GlaudeCode launched, so the smart-approval hook only gates *these* sessions
    // — never a bare `claude` someone runs in the repo (which would otherwise be stranded
    // when the app, and thus the approval engine, is closed).
    builder.env("GLAUDECODE_MANAGED", "1");

    let child = pair.slave.spawn_command(builder).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    registry.panes.lock().unwrap().insert(
        pane_id.clone(),
        PaneHandle { writer, master: pair.master, child },
    );

    let out_event = format!("pty-output:{pane_id}");
    let exit_event = format!("pty-exit:{pane_id}");
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let _ = app.emit(&out_event, buf[..n].to_vec());
                }
                Err(_) => break,
            }
        }
        // PTY closed: the child exited (or was killed). Drop its handle so the
        // registry doesn't leak, then notify the pane.
        app.state::<PtyRegistry>()
            .panes
            .lock()
            .unwrap()
            .remove(&pane_id);
        let _ = app.emit(&exit_event, ());
    });

    Ok(())
}

#[tauri::command]
fn pty_write(registry: State<PtyRegistry>, pane_id: String, data: String) -> Result<(), String> {
    let mut panes = registry.panes.lock().unwrap();
    let pane = panes
        .get_mut(&pane_id)
        .ok_or_else(|| format!("no such pane: {pane_id}"))?;
    pane.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    pane.writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn pty_resize(
    registry: State<PtyRegistry>,
    pane_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let panes = registry.panes.lock().unwrap();
    let pane = panes
        .get(&pane_id)
        .ok_or_else(|| format!("no such pane: {pane_id}"))?;
    pane.master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn pty_kill(registry: State<PtyRegistry>, pane_id: String) -> Result<(), String> {
    // Take the handle out and kill the child; dropping master/writer closes the
    // PTY, the reader thread sees EOF and emits `pty-exit:{paneId}`.
    if let Some(mut pane) = registry.panes.lock().unwrap().remove(&pane_id) {
        let _ = pane.child.kill();
    }
    Ok(())
}

// ---------- Engine sidecar ----------

#[derive(Clone, Serialize, Deserialize)]
struct EngineEndpoint {
    port: u16,
    token: String,
}

#[derive(Default)]
struct EngineState {
    endpoint: Mutex<Option<EngineEndpoint>>,
    child: Mutex<Option<Child>>,
}

fn engine_entry_path() -> PathBuf {
    if let Ok(p) = std::env::var("GLAUDE_ENGINE_ENTRY") {
        return PathBuf::from(p);
    }
    // <crate>/../../engine/bin/serve.ts  (dev layout: packages/desktop/src-tauri)
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let path = manifest.join("../../engine/bin/serve.ts");
    std::fs::canonicalize(&path).unwrap_or(path)
}

fn spawn_engine(state: &EngineState) -> Result<(), String> {
    let entry = engine_entry_path();
    let mut child = Command::new("bun")
        .arg(&entry)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("failed to spawn engine (bun {:?}): {}", entry, e))?;

    let stdout = child.stdout.take().ok_or("engine produced no stdout")?;
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    reader
        .read_line(&mut line)
        .map_err(|e| format!("reading engine handshake: {}", e))?;
    let endpoint: EngineEndpoint = serde_json::from_str(line.trim())
        .map_err(|e| format!("bad engine handshake '{}': {}", line.trim(), e))?;

    // Drain the rest of stdout so the pipe never blocks the engine.
    thread::spawn(move || {
        for _ in reader.lines() {}
    });

    *state.endpoint.lock().unwrap() = Some(endpoint);
    *state.child.lock().unwrap() = Some(child);
    Ok(())
}

#[tauri::command]
fn engine_endpoint(state: State<EngineState>) -> Result<EngineEndpoint, String> {
    state
        .endpoint
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "engine not ready".to_string())
}

/// The project directory whose sessions the UI should list — the nearest git
/// repo root at/above the process cwd, else the cwd itself.
#[tauri::command]
fn project_dir() -> String {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let mut dir = cwd.as_path();
    loop {
        if dir.join(".git").exists() {
            return dir.to_string_lossy().into_owned();
        }
        match dir.parent() {
            Some(p) => dir = p,
            None => break,
        }
    }
    cwd.to_string_lossy().into_owned()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(PtyRegistry::default())
        .manage(EngineState::default())
        .setup(|app| {
            if let Err(e) = spawn_engine(app.state::<EngineState>().inner()) {
                eprintln!("[glaudecode] engine sidecar failed: {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            engine_endpoint,
            project_dir
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(mut child) = app_handle.state::<EngineState>().child.lock().unwrap().take() {
                let _ = child.kill();
            }
        }
    });
}
