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
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use tauri::{AppHandle, Emitter, Manager, State};

mod pane_bridge;

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
    /// Panes the user has armed for remote (phone) input (V5 Phase 2). Default empty = nothing
    /// accepts remote input. This Rust set is the AUTHORITATIVE arming gate — the engine keeps a
    /// mirrored copy (for an early gate + the phone UI), but a write only ever reaches a PTY if the
    /// pane is in THIS set, checked at the moment of write.
    armed: Mutex<HashSet<String>>,
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
    engine: State<EngineState>,
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

    // Tee this pane to the phone mirror (V5 Phase 1): announce it (META + SIZE) and clone the
    // bridge sender into the reader thread. Best-effort — if the bridge isn't up, the local
    // terminal is unaffected.
    let bridge = engine.bridge.lock().unwrap().clone();
    if let Some(tx) = &bridge {
        let title = cmd.clone().unwrap_or_else(|| "shell".to_string());
        let _ = tx.try_send(pane_bridge::encode_meta(&pane_id, &title));
        let _ = tx.try_send(pane_bridge::encode_size(&pane_id, cols, rows));
    }

    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let _ = app.emit(&out_event, buf[..n].to_vec());
                    if let Some(tx) = &bridge {
                        let _ = tx.try_send(pane_bridge::encode_output(&pane_id, &buf[..n]));
                    }
                }
                Err(_) => break,
            }
        }
        // PTY closed: the child exited (or was killed). Tell the mirror, drop the handle so the
        // registry doesn't leak, then notify the pane.
        if let Some(tx) = &bridge {
            let _ = tx.try_send(pane_bridge::encode_close(&pane_id));
        }
        let reg = app.state::<PtyRegistry>();
        reg.panes.lock().unwrap().remove(&pane_id);
        reg.armed.lock().unwrap().remove(&pane_id); // a dead pane can never be armed
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

/// Write bytes a PHONE typed to a pane's PTY — the authoritative remote-input gate (V5 Phase 2).
/// Called from the input-bridge reader thread with bytes the engine already gated (terminal scope +
/// armed pane). We re-check arming HERE, closest to the PTY: even a compromised/buggy engine cannot
/// type into a pane the user hasn't armed. Silently drops anything for an unarmed/unknown pane.
fn pty_write_internal(app: &AppHandle, pane_id: &str, data: &[u8]) {
    let registry = app.state::<PtyRegistry>();
    if !registry.armed.lock().unwrap().contains(pane_id) {
        return; // not armed → never reaches the shell
    }
    let mut panes = registry.panes.lock().unwrap();
    if let Some(pane) = panes.get_mut(pane_id) {
        if pane.writer.write_all(data).is_ok() {
            let _ = pane.writer.flush();
            // Live "📱 phone is driving this pane" echo for the desktop UI.
            let _ = app.emit(&format!("pane-remote-input:{pane_id}"), ());
        }
    }
}

/// Resize a pane's PTY from a PHONE that has taken control of size (V5 Phase 4) — the authoritative
/// arming gate, exactly like `pty_write_internal`. Called from the input-bridge thread with a size
/// the engine already gated (terminal scope + armed pane). We re-check arming HERE, resize the
/// master, then mirror the new size back to the engine (output bridge) so the phone + any other
/// viewer re-render. Silently drops for an unarmed/unknown pane.
fn pty_resize_internal(app: &AppHandle, pane_id: &str, cols: u16, rows: u16) {
    let registry = app.state::<PtyRegistry>();
    if !registry.armed.lock().unwrap().contains(pane_id) {
        return; // not armed → never resizes the desktop pane
    }
    {
        let panes = registry.panes.lock().unwrap();
        if let Some(pane) = panes.get(pane_id) {
            let _ = pane.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 });
        }
    }
    if let Some(tx) = app.state::<EngineState>().bridge.lock().unwrap().as_ref() {
        let _ = tx.try_send(pane_bridge::encode_size(pane_id, cols, rows));
    }
    let _ = app.emit(&format!("pane-remote-input:{pane_id}"), ()); // live "phone is driving" echo
}

/// Arm / disarm a pane for remote (phone) input (V5 Phase 2). Default is disarmed; this is a
/// deliberate, local desktop action. Mirrors the new state to the engine so it can gate input early
/// + reflect armed state on the phone. The Rust `armed` set remains authoritative.
#[tauri::command]
fn pty_set_armed(
    registry: State<PtyRegistry>,
    engine: State<EngineState>,
    pane_id: String,
    armed: bool,
) -> Result<(), String> {
    {
        let mut set = registry.armed.lock().unwrap();
        if armed {
            set.insert(pane_id.clone());
        } else {
            set.remove(&pane_id);
        }
    }
    if let Some(tx) = engine.bridge.lock().unwrap().as_ref() {
        let _ = tx.try_send(pane_bridge::encode_arm(&pane_id, armed));
    }
    Ok(())
}

/// Kill switch (V5 Phase 2): disarm every pane at once. Returns the pane ids that were armed so the
/// UI can clear their toggles. Pushes ARM=off to the engine for each.
#[tauri::command]
fn pty_disarm_all(registry: State<PtyRegistry>, engine: State<EngineState>) -> Result<Vec<String>, String> {
    let ids: Vec<String> = {
        let mut set = registry.armed.lock().unwrap();
        let ids = set.iter().cloned().collect();
        set.clear();
        ids
    };
    if let Some(tx) = engine.bridge.lock().unwrap().as_ref() {
        for id in &ids {
            let _ = tx.try_send(pane_bridge::encode_arm(id, false));
        }
    }
    Ok(ids)
}

#[tauri::command]
fn pty_resize(
    registry: State<PtyRegistry>,
    engine: State<EngineState>,
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
    // Mirror the new size to the phone so its xterm re-renders correctly (V5 Phase 1).
    if let Some(tx) = engine.bridge.lock().unwrap().as_ref() {
        let _ = tx.try_send(pane_bridge::encode_size(&pane_id, cols, rows));
    }
    Ok(())
}

#[tauri::command]
fn pty_kill(registry: State<PtyRegistry>, pane_id: String) -> Result<(), String> {
    // Take the handle out and kill the child; dropping master/writer closes the
    // PTY, the reader thread sees EOF and emits `pty-exit:{paneId}`.
    if let Some(mut pane) = registry.panes.lock().unwrap().remove(&pane_id) {
        let _ = pane.child.kill();
    }
    registry.armed.lock().unwrap().remove(&pane_id); // killed pane can't stay armed
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
    /// Sender into the pane bridge — tees PTY output to the engine for the phone mirror (V5 Phase 1).
    bridge: Mutex<Option<pane_bridge::BridgeTx>>,
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

fn spawn_engine(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<EngineState>();
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

    *state.endpoint.lock().unwrap() = Some(endpoint.clone());
    *state.child.lock().unwrap() = Some(child);
    // Start the pane bridge so PTY output can mirror to phones via the engine (V5 Phase 1). It
    // connects to this engine's /pane-bridge with the bearer token; PTY reader threads tee into it.
    *state.bridge.lock().unwrap() = Some(pane_bridge::start(endpoint.port, endpoint.token.clone()));
    // Start the INPUT bridge (V5 Phase 2): the engine pushes phone keystrokes back over a second,
    // bearer-only socket; each lands in pty_write_internal, which re-checks arming before the PTY.
    let app_for_input = app.clone();
    pane_bridge::start_input(endpoint.port, endpoint.token.clone(), move |op, pane_id, data| {
        if op == pane_bridge::OP_INPUT {
            pty_write_internal(&app_for_input, pane_id, data);
        } else if op == pane_bridge::OP_RESIZE && data.len() >= 4 {
            let cols = u16::from_be_bytes([data[0], data[1]]);
            let rows = u16::from_be_bytes([data[2], data[3]]);
            pty_resize_internal(&app_for_input, pane_id, cols, rows);
        }
    });
    // Each launch gets a fresh port; if the approval hook is installed, refresh its endpoint
    // file so it keeps working across restarts (instead of pointing at the dead old engine).
    refresh_approval_endpoint(&endpoint);
    Ok(())
}

/// If the smart-approval hook is installed for the project, rewrite its endpoint file with this
/// launch's {port, token}. No-op when the hook isn't installed.
fn refresh_approval_endpoint(endpoint: &EngineEndpoint) {
    let project = find_project_dir();
    let installed = std::fs::read_to_string(project.join(".claude").join("settings.json"))
        .map(|s| s.contains("glaudecode-approval"))
        .unwrap_or(false);
    if !installed {
        return;
    }
    let endpoint_file = project.join(".glaudecode").join("approval-endpoint.json");
    let json = serde_json::json!({ "port": endpoint.port, "token": endpoint.token });
    // The file carries the engine bearer token → restrict to the owner (0o600, dir 0o700).
    #[cfg(unix)]
    {
        use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
        if let Some(parent) = endpoint_file.parent() {
            let _ = std::fs::DirBuilder::new().recursive(true).mode(0o700).create(parent);
        }
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&endpoint_file)
        {
            let _ = f.write_all(json.to_string().as_bytes());
        }
    }
    #[cfg(not(unix))]
    {
        if let Some(parent) = endpoint_file.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&endpoint_file, json.to_string());
    }
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

/// The nearest git repo root at/above the process cwd, else the cwd itself.
fn find_project_dir() -> PathBuf {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let mut dir = cwd.as_path();
    loop {
        if dir.join(".git").exists() {
            return dir.to_path_buf();
        }
        match dir.parent() {
            Some(p) => dir = p,
            None => break,
        }
    }
    cwd
}

/// The project directory whose sessions the UI should list.
#[tauri::command]
fn project_dir() -> String {
    find_project_dir().to_string_lossy().into_owned()
}

/// This machine's Tailscale IPv4 (e.g. 100.x.y.z), or None if Tailscale isn't installed/up.
/// Used to bind the engine's remote listener to the tailnet only (Epic G remote).
#[tauri::command]
fn tailscale_ip() -> Option<String> {
    // The CLI may be on PATH (standalone install) or inside the App Store app bundle.
    let candidates = ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"];
    for bin in candidates {
        if let Ok(out) = Command::new(bin).args(["ip", "-4"]).output() {
            if out.status.success() {
                if let Some(ip) = String::from_utf8_lossy(&out.stdout)
                    .lines()
                    .map(|l| l.trim())
                    .find(|l| !l.is_empty())
                {
                    return Some(ip.to_string());
                }
            }
        }
    }
    None
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
            if let Err(e) = spawn_engine(&app.handle().clone()) {
                eprintln!("[glaudecode] engine sidecar failed: {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            pty_set_armed,
            pty_disarm_all,
            engine_endpoint,
            project_dir,
            tailscale_ip
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            // Remove our PreToolUse approval hook so a closed app can never leave a hook
            // behind that gates (and, when the engine is down, denies) tools. Defense in
            // depth — GLAUDECODE_MANAGED scoping already spares non-managed sessions.
            uninstall_approval_hook_on_exit();
            if let Some(mut child) = app_handle.state::<EngineState>().child.lock().unwrap().take() {
                let _ = child.kill();
            }
        }
    });
}

/// Strip our approval hook (marked by the `glaudecode-approval` sentinel) from the project's
/// `.claude/settings.json` on app exit. Conservative: parse-or-bail — if the file is missing,
/// unparseable, or doesn't contain our sentinel, we touch nothing. Mirrors the engine's
/// `removeApprovalHook` (pruning empties) so the file returns to its prior shape.
fn uninstall_approval_hook_on_exit() {
    const SENTINEL: &str = "glaudecode-approval";
    let path = find_project_dir().join(".claude").join("settings.json");
    let Ok(raw) = std::fs::read_to_string(&path) else { return };
    if !raw.contains(SENTINEL) {
        return;
    }
    let Ok(mut root) = serde_json::from_str::<serde_json::Value>(&raw) else { return };
    let Some(obj) = root.as_object_mut() else { return };
    let Some(hooks) = obj.get_mut("hooks").and_then(|h| h.as_object_mut()) else { return };

    if let Some(pre) = hooks.get_mut("PreToolUse").and_then(|p| p.as_array_mut()) {
        // Drop our command from each matcher, then drop matchers left with no hooks.
        for matcher in pre.iter_mut() {
            if let Some(list) = matcher.get_mut("hooks").and_then(|h| h.as_array_mut()) {
                list.retain(|h| {
                    h.get("command").and_then(|c| c.as_str()).map_or(true, |c| !c.contains(SENTINEL))
                });
            }
        }
        pre.retain(|m| m.get("hooks").and_then(|h| h.as_array()).is_none_or(|l| !l.is_empty()));
        if pre.is_empty() {
            hooks.remove("PreToolUse");
        }
    }
    if hooks.is_empty() {
        obj.remove("hooks");
    }

    // Pretty-print to match the engine's writer; if serialization somehow fails, leave the
    // file untouched rather than risk truncating the user's settings.
    if let Ok(out) = serde_json::to_string_pretty(&root) {
        let _ = std::fs::write(&path, out + "\n");
    }
}
