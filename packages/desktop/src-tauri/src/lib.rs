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
use std::time::{Duration, Instant};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use tauri::{AppHandle, Emitter, Manager, State};

mod keep_awake;
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
    // Last-known meta/size, so the bridge can replay META+SIZE+ARM for every live pane after a
    // (re)connect and the engine mirror never loses an armed pane on a blip (audit M13).
    title: String,
    cols: u16,
    rows: u16,
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

/// The interactive shell to spawn — `$SHELL` when set (covers WSL, which presents as Linux), else an
/// OS-appropriate default (V5 Phase 6 / 6.1.3 + 6.3.1). The old hard `/bin/bash` default is invalid
/// on native Windows; PowerShell is the sane fallback there.
fn default_shell() -> String {
    if let Ok(s) = std::env::var("SHELL") {
        if !s.is_empty() {
            return s;
        }
    }
    #[cfg(windows)]
    {
        return "powershell.exe".to_string();
    }
    #[cfg(not(windows))]
    {
        "/bin/bash".to_string()
    }
}

/// OSC 133/7 shell integration for **bash** (V5 Phase 6 / 6.1.1). Writes a private rcfile that
/// sources the user's real ~/.bashrc first (never modifies it), then emits the same OSC markers the
/// WebView parses (V3-E2): 133;C on command start (DEBUG trap), 133;D;<exit> + 133;A + OSC 7 cwd
/// before each prompt (PROMPT_COMMAND). Returns the rcfile path; best-effort (shell still spawns if
/// this fails). NOTE: behavioral verification is the real-Linux QA gate.
fn setup_bash_integration() -> Option<String> {
    let home = std::env::var("HOME").ok()?;
    let dir = PathBuf::from(&home).join(".glaudecode").join("shell");
    std::fs::create_dir_all(&dir).ok()?;
    let rc = dir.join("bash-integration.bash");
    // `\e` is written literally; bash's printf interprets it as ESC at runtime (like the zsh script).
    let body = r#"# GlaudeCode bash integration — sources your real ~/.bashrc, then adds OSC 133/7 markers.
[ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc"
_glaude_preexec() { printf '\e]133;C\e\\'; }
_glaude_precmd() { local ec=$?; printf '\e]133;D;%s\e\\' "$ec"; printf '\e]133;A\e\\'; printf '\e]7;file://%s%s\e\\' "${HOSTNAME:-}" "$PWD"; }
# DEBUG fires before every command; skip it while PROMPT_COMMAND runs so we mark real commands only.
trap '[ "$BASH_COMMAND" = "$PROMPT_COMMAND" ] || _glaude_preexec' DEBUG
# Idempotent: don't prepend _glaude_precmd again if the rcfile is re-sourced (audit L18) — otherwise
# it duplicates the OSC 133;D markers on every prompt.
case "$PROMPT_COMMAND" in
  *_glaude_precmd*) ;;
  *) PROMPT_COMMAND='_glaude_precmd'"${PROMPT_COMMAND:+; $PROMPT_COMMAND}" ;;
esac
"#;
    std::fs::write(&rc, body).ok()?;
    Some(rc.to_string_lossy().into_owned())
}

/// OSC 133/7 shell integration for **fish** (V5 Phase 6 / 6.1.2). Points fish at a private
/// XDG_CONFIG_HOME whose config.fish sources the user's real config, plus a conf.d snippet that
/// emits the OSC markers via fish's native preexec/postexec events. Returns the XDG_CONFIG_HOME dir;
/// best-effort. NOTE: behavioral verification is the real-Linux QA gate.
/// The fish `--init-command` that adds OSC 133/7 markers via fish's native preexec/postexec events.
/// Injected with `-C` rather than by overriding XDG_CONFIG_HOME (audit L18): the old approach pointed
/// XDG_CONFIG_HOME at a wrapper dir for the WHOLE process tree, breaking git/gh/nvim/starship config
/// resolution in every nested command. With `--init-command` the user's real fish config loads
/// normally and only our session gets the markers.
fn fish_init_command() -> String {
    "function _glaude_preexec --on-event fish_preexec; printf '\\e]133;C\\e\\\\'; end; \
     function _glaude_postexec --on-event fish_postexec; printf '\\e]133;D;%s\\e\\\\' $status; \
     printf '\\e]133;A\\e\\\\'; printf '\\e]7;file://%s%s\\e\\\\' (hostname) $PWD; end"
        .to_string()
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
            // OS-aware shell (Phase 6): $SHELL when set (covers WSL = Linux), else an OS default.
            let shell = default_shell();
            let shell_name = std::path::Path::new(&shell)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            let mut b = CommandBuilder::new(&shell);
            // POSIX shells take a login flag; PowerShell/cmd don't. bash is the exception — it reads
            // our --rcfile only as a NON-login interactive shell (login bash ignores --rcfile).
            #[cfg(not(windows))]
            {
                if shell_name != "bash" {
                    b.arg("-l");
                }
            }
            // Per-shell OSC 133/7 integration, injected ONLY into GlaudeCode's shells (the user's own
            // rc files are sourced first, never modified). Best-effort: on failure the shell still spawns.
            match shell_name.as_str() {
                "zsh" => {
                    if let Some((wrapper, real)) = setup_zsh_autosuggestions() {
                        b.env("ZDOTDIR", &wrapper);
                        b.env("_GLAUDE_REAL_ZDOTDIR", &real);
                    }
                }
                "bash" => {
                    if let Some(rc) = setup_bash_integration() {
                        b.arg("--rcfile");
                        b.arg(&rc);
                    }
                }
                "fish" => {
                    // -C / --init-command, NOT an XDG override, so nested commands keep their real
                    // config (audit L18).
                    b.arg("--init-command");
                    b.arg(fish_init_command());
                }
                _ => {} // PowerShell / cmd (native Windows) + others: plain shell, no OSC integration.
            }
            b
        }
    };
    // Working directory: the requested cwd if it's a real directory (a saved "last shell dir" may
    // since have been deleted/renamed — never spawn into a ghost path), else the user's HOME (a sane
    // default — NOT the app's own folder), else the process cwd as a last resort.
    let workdir = cwd
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| std::env::var("HOME").ok().map(PathBuf::from).filter(|p| p.is_dir()))
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

    // A fresh pane starts DISARMED — clear any stale entry for a reused id so it can't inherit
    // arming from a prior pane (audit L7).
    registry.armed.lock().unwrap().remove(&pane_id);
    let title = cmd.clone().unwrap_or_else(|| "shell".to_string());
    registry.panes.lock().unwrap().insert(
        pane_id.clone(),
        PaneHandle { writer, master: pair.master, child, title: title.clone(), cols, rows },
    );

    let out_event = format!("pty-output:{pane_id}");
    let exit_event = format!("pty-exit:{pane_id}");

    // Tee this pane to the phone mirror (V5 Phase 1): announce it (META + SIZE) to the CURRENT bridge.
    // Best-effort — if the bridge isn't up, the local terminal is unaffected.
    if let Some(tx) = engine.bridge.lock().unwrap().as_ref() {
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
                    // Resolve the LIVE sender per chunk (never a captured clone): after an engine
                    // respawn the sender is swapped, and an already-open pane must follow the NEW
                    // engine or it goes permanently blank on the phone (mirror fix #1). try_send still
                    // drops-on-full, so a slow/disconnected engine never stalls the local PTY. The
                    // lock is held only for this non-blocking try_send — microseconds, no I/O under it.
                    if let Some(tx) = app.state::<EngineState>().bridge.lock().unwrap().as_ref() {
                        let _ = tx.try_send(pane_bridge::encode_output(&pane_id, &buf[..n]));
                    }
                }
                Err(_) => break,
            }
        }
        // PTY closed: the child exited (or was killed). Tell the mirror, drop the handle so the
        // registry doesn't leak, then notify the pane.
        if let Some(tx) = app.state::<EngineState>().bridge.lock().unwrap().as_ref() {
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

/// Pure arming-gate predicate (audit M20): a phone write/resize reaches a pane's PTY ONLY if the
/// pane id is in the armed set. Factored out of pty_write_internal/pty_resize_internal so the single
/// most important security decision in the Rust core is unit-tested (it previously had zero tests).
fn is_armed(armed: &HashSet<String>, pane_id: &str) -> bool {
    armed.contains(pane_id)
}

/// Write bytes a PHONE typed to a pane's PTY — the authoritative remote-input gate (V5 Phase 2).
/// Called from the input-bridge reader thread with bytes the engine already gated (terminal scope +
/// armed pane). We re-check arming HERE, closest to the PTY: even a compromised/buggy engine cannot
/// type into a pane the user hasn't armed. Silently drops anything for an unarmed/unknown pane.
fn pty_write_internal(app: &AppHandle, pane_id: &str, data: &[u8]) {
    let registry = app.state::<PtyRegistry>();
    if !is_armed(&registry.armed.lock().unwrap(), pane_id) {
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
    if !is_armed(&registry.armed.lock().unwrap(), pane_id) {
        return; // not armed → never resizes the desktop pane
    }
    // Clamp to a sane terminal size, mirroring the engine (audit M2): even if a malformed RESIZE got
    // past the engine, a 0x0 / 65535 frame must never reach the real PTY.
    let cols = cols.clamp(1, 1000);
    let rows = rows.clamp(1, 1000);
    {
        let mut panes = registry.panes.lock().unwrap();
        if let Some(pane) = panes.get_mut(pane_id) {
            let _ = pane.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 });
            pane.cols = cols; // remember for the M13 reconnect replay
            pane.rows = rows;
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
    app: AppHandle,
    registry: State<PtyRegistry>,
    engine: State<EngineState>,
    pane_id: String,
    armed: bool,
) -> Result<(), String> {
    // Don't arm a pane that doesn't exist — keep `armed ⊆ live panes` so a phantom id can't sit
    // "armed" (audit L7). Check panes (lock + release) before touching `armed` — never nested.
    if armed && !registry.panes.lock().unwrap().contains_key(&pane_id) {
        return Err(format!("no such pane: {pane_id}"));
    }
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
    emit_armed_changed(&app, registry.inner()); // keep the WebView's mirror authoritative
    Ok(())
}

/// Emit the authoritative armed set to the WebView so its arm/kill UI can never desync from the
/// long-lived Rust core (audit H2). A WebView reload (vite HMR, ErrorBoundary remount, any refresh)
/// re-runs the renderer WITHOUT respawning Rust — the WebView must re-read `armed` from here, and we
/// also push it on every change so a still-armed pane never silently renders "off".
fn emit_armed_changed(app: &AppHandle, registry: &PtyRegistry) {
    let ids: Vec<String> = registry.armed.lock().unwrap().iter().cloned().collect();
    let _ = app.emit("armed-changed", ids);
}

/// Read the authoritative armed pane ids (audit H2). The WebView hydrates from this on mount + focus
/// so a reload can't lose the arm state (or hide the kill switch) while phone input still flows.
#[tauri::command]
fn pty_list_armed(registry: State<PtyRegistry>) -> Result<Vec<String>, String> {
    Ok(registry.armed.lock().unwrap().iter().cloned().collect())
}

/// Kill switch (V5 Phase 2): disarm every pane at once. Returns the pane ids that were armed so the
/// UI can clear their toggles. Pushes ARM=off to the engine for each.
#[tauri::command]
fn pty_disarm_all(
    app: AppHandle,
    registry: State<PtyRegistry>,
    engine: State<EngineState>,
) -> Result<Vec<String>, String> {
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
    emit_armed_changed(&app, registry.inner()); // now-empty set → WebView clears every toggle
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
    let mut panes = registry.panes.lock().unwrap();
    let pane = panes
        .get_mut(&pane_id)
        .ok_or_else(|| format!("no such pane: {pane_id}"))?;
    pane.master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    pane.cols = cols; // remember for the M13 reconnect replay
    pane.rows = rows;
    drop(panes);
    // Mirror the new size to the phone so its xterm re-renders correctly (V5 Phase 1).
    if let Some(tx) = engine.bridge.lock().unwrap().as_ref() {
        let _ = tx.try_send(pane_bridge::encode_size(&pane_id, cols, rows));
    }
    Ok(())
}

#[tauri::command]
fn pty_kill(app: AppHandle, registry: State<PtyRegistry>, pane_id: String) -> Result<(), String> {
    // Take the handle out and kill the child; dropping master/writer closes the
    // PTY, the reader thread sees EOF and emits `pty-exit:{paneId}`.
    if let Some(mut pane) = registry.panes.lock().unwrap().remove(&pane_id) {
        let _ = pane.child.kill();
    }
    let was_armed = registry.armed.lock().unwrap().remove(&pane_id); // killed pane can't stay armed
    if was_armed {
        emit_armed_changed(&app, registry.inner());
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
    /// Sender into the pane bridge — tees PTY output to the engine for the phone mirror (V5 Phase 1).
    /// PTY reader threads resolve THIS (the current sender) per chunk — never a captured clone — so
    /// an engine respawn that swaps the sender is transparent to already-open panes (mirror fix #1).
    bridge: Mutex<Option<pane_bridge::BridgeTx>>,
    /// Stop flag for the current input-bridge thread, so a respawn can retire the old one instead of
    /// leaving it to reconnect-loop forever against the dead port (audit M6 GAP B).
    input_stop: Mutex<Option<Arc<AtomicBool>>>,
    /// Stop flag for the current OUTPUT-bridge pump, retired on respawn for the same reason — without
    /// it the orphaned pump reconnect-loops the dead port and drains-and-discards output (mirror #1).
    output_stop: Mutex<Option<Arc<AtomicBool>>>,
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
    // Read the {port,token} handshake on a worker thread bounded by a timeout (audit M6): a
    // wedged/never-printing engine must NOT block app launch forever. The same thread then keeps
    // draining stdout so the pipe never backs up. The first line (or an error) comes back over a
    // channel; we give it 10s.
    let (tx, rx) = std::sync::mpsc::channel::<Result<String, String>>();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) => {
                let _ = tx.send(Err("engine closed stdout before the handshake".to_string()));
                return;
            }
            Ok(_) => {
                let _ = tx.send(Ok(line));
            }
            Err(e) => {
                let _ = tx.send(Err(format!("reading engine handshake: {e}")));
                return;
            }
        }
        for _ in reader.lines() {} // keep draining so the engine never blocks on a full pipe
    });
    let line = match rx.recv_timeout(Duration::from_secs(10)) {
        Ok(Ok(l)) => l,
        Ok(Err(e)) => {
            let _ = child.kill();
            return Err(e);
        }
        Err(_) => {
            let _ = child.kill();
            return Err("engine handshake timed out (10s)".to_string());
        }
    };
    let endpoint: EngineEndpoint = serde_json::from_str(line.trim())
        .map_err(|e| format!("bad engine handshake '{}': {}", line.trim(), e))?;

    *state.endpoint.lock().unwrap() = Some(endpoint.clone());
    *state.child.lock().unwrap() = Some(child);
    // Start the pane bridge so PTY output can mirror to phones via the engine (V5 Phase 1). It
    // connects to this engine's /pane-bridge with the bearer token; PTY reader threads tee into it.
    // The bridge replays META+SIZE+ARM for every live pane on each (re)connect (audit M13). Lock
    // `armed` first (clone + release), THEN `panes`, so we never nest the two locks (no deadlock).
    // Retire the PREVIOUS output-bridge pump first (on respawn) so it stops reconnecting to the dead
    // port; with the per-chunk sender resolve below, existing panes then tee to the NEW engine.
    if let Some(old_stop) = state.output_stop.lock().unwrap().take() {
        old_stop.store(true, Ordering::SeqCst);
    }
    let output_stop = Arc::new(AtomicBool::new(false));
    *state.output_stop.lock().unwrap() = Some(output_stop.clone());
    let app_for_resync = app.clone();
    *state.bridge.lock().unwrap() = Some(pane_bridge::start(endpoint.port, endpoint.token.clone(), output_stop, move || {
        let registry = app_for_resync.state::<PtyRegistry>();
        let armed: HashSet<String> = registry.armed.lock().unwrap().clone();
        let panes = registry.panes.lock().unwrap();
        let mut frames = Vec::with_capacity(panes.len() * 3);
        for (id, h) in panes.iter() {
            frames.push(pane_bridge::encode_meta(id, &h.title));
            frames.push(pane_bridge::encode_size(id, h.cols, h.rows));
            frames.push(pane_bridge::encode_arm(id, armed.contains(id)));
        }
        frames
    }));
    // Start the INPUT bridge (V5 Phase 2): the engine pushes phone keystrokes back over a second,
    // bearer-only socket; each lands in pty_write_internal, which re-checks arming before the PTY.
    // Retire the PREVIOUS input-bridge thread first (on respawn) so it stops reconnecting to the dead
    // port instead of leaking forever (audit M6 GAP B).
    if let Some(old_stop) = state.input_stop.lock().unwrap().take() {
        old_stop.store(true, Ordering::SeqCst);
    }
    let input_stop = Arc::new(AtomicBool::new(false));
    *state.input_stop.lock().unwrap() = Some(input_stop.clone());
    let app_for_input = app.clone();
    pane_bridge::start_input(endpoint.port, endpoint.token.clone(), input_stop, move |op, pane_id, data| {
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

/// Watchdog for the engine sidecar (audit M6). Without it, a post-handshake engine crash silently
/// disabled all remote/RPC with no signal (the bridges reconnect-loop forever, RPCs just fail). This
/// thread polls the child; on exit it emits `engine-exit` (so the WebView can show a banner) and
/// attempts a BOUNDED respawn. After too many failures it emits `engine-down` and stops, rather than
/// crash-looping. It also brings the engine up if the initial launch failed (child is None).
fn supervise_engine(app: AppHandle) {
    thread::spawn(move || {
        let mut restarts: u32 = 0;
        let mut healthy_ticks: u32 = 0;
        loop {
            thread::sleep(Duration::from_secs(2));
            let needs_respawn = {
                let state = app.state::<EngineState>();
                let mut guard = state.child.lock().unwrap();
                match guard.as_mut() {
                    Some(child) => matches!(child.try_wait(), Ok(Some(_))), // exited
                    None => true, // initial spawn failed — try to bring it up
                }
            };
            if !needs_respawn {
                // After a sustained healthy window (~30s), forgive prior restarts so the cap is a
                // crash-LOOP rate limit, not a per-session lifetime cap (audit M6 GAP A) — an engine
                // that crashes once an hour but recovers each time never trips engine-down.
                healthy_ticks += 1;
                if healthy_ticks >= 15 {
                    restarts = 0;
                }
                continue;
            }
            healthy_ticks = 0;
            if restarts >= 5 {
                eprintln!("[glaudecode] engine down after {restarts} respawn attempts — giving up");
                let _ = app.emit("engine-down", "engine unavailable — restart GlaudeCode");
                return; // bounded — never crash-loop
            }
            restarts += 1;
            // Logged to stderr (not only the WebView event) so a respawn is visible in `tauri dev`
            // output — it's the trigger for the mirror-blank class of bugs, so we want it on the record.
            eprintln!("[glaudecode] engine sidecar exited — respawn attempt #{restarts}");
            let _ = app.emit("engine-exit", restarts);
            match spawn_engine(&app) {
                Ok(_) => {
                    eprintln!("[glaudecode] engine respawned (#{restarts}); existing panes re-tee to the new sender");
                    let _ = app.emit("engine-respawned", restarts);
                }
                Err(e) => eprintln!("[glaudecode] engine respawn failed: {e}"),
            }
        }
    });
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

/// The nearest git repo root at/above the process cwd, else the cwd itself. The result is
/// process-stable (cwd doesn't change after launch), so cache it in a OnceLock instead of walking the
/// filesystem on every call (audit L19).
fn find_project_dir() -> PathBuf {
    static PROJECT_DIR: OnceLock<PathBuf> = OnceLock::new();
    PROJECT_DIR
        .get_or_init(|| {
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
        })
        .clone()
}

/// The project directory whose sessions the UI should list.
#[tauri::command]
fn project_dir() -> String {
    find_project_dir().to_string_lossy().into_owned()
}

/// True on native Windows (V5 Phase 6 / 6.3.3) — the UI uses this to surface a "use WSL for full
/// features" note, since native Windows is the experimental tier (no shell OSC integration).
#[tauri::command]
fn os_is_windows() -> bool {
    cfg!(target_os = "windows")
}

/// Tailscale CLI candidate paths — the SINGLE source (Phase 6 / 6.3.2 adds Windows paths here, and
/// the serve helper reuses it). The CLI may be on PATH (standalone) or in the App Store app bundle.
fn tailscale_candidates() -> &'static [&'static str] {
    // Each is tried in order; non-existent ones simply fail to spawn and are skipped — so listing
    // every OS's paths here is safe and keeps discovery as ONE source (V5 Phase 6 / 6.3.2 Windows).
    &[
        "tailscale",
        "/Applications/Tailscale.app/Contents/MacOS/Tailscale", // macOS App Store bundle
        "tailscale.exe",                                         // Windows on PATH
        "C:\\Program Files\\Tailscale\\tailscale.exe",          // Windows default install
    ]
}

/// Run the Tailscale CLI with `args`, returning the output of the first candidate that SUCCEEDS,
/// bounded by `timeout` — a stalled tailscale (e.g. `serve --https` provisioning a cert when HTTPS
/// certs aren't enabled in the tailnet) is KILLED and treated as a failure rather than hanging the
/// caller. Without this a blocking shell-out from a synchronous Tauri command froze the whole UI.
fn run_tailscale_timeout(args: &[&str], timeout: Duration) -> Option<std::process::Output> {
    for bin in tailscale_candidates() {
        let mut child = match Command::new(bin)
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(_) => continue, // binary not at this path → try the next candidate
        };
        let start = Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break, // exited — fall through to read its output
                Ok(None) => {
                    if start.elapsed() > timeout {
                        let _ = child.kill();
                        let _ = child.wait();
                        return None; // stalled → FAIL FAST so the caller can fall back, never hang
                    }
                    thread::sleep(Duration::from_millis(50));
                }
                Err(_) => return None,
            }
        }
        if let Ok(out) = child.wait_with_output() {
            if out.status.success() {
                return Some(out);
            }
        }
    }
    None
}

/// Run the Tailscale CLI, bounded by a default timeout. The status/ip/dns queries are quick; the
/// generous cap is just a backstop against a wedged tailscaled.
fn run_tailscale(args: &[&str]) -> Option<std::process::Output> {
    run_tailscale_timeout(args, Duration::from_secs(6))
}

/// This machine's Tailscale IPv4 (e.g. 100.x.y.z), or None if Tailscale isn't installed/up.
/// Used to bind the engine's remote listener to the tailnet (the zero-config fallback path).
#[tauri::command]
async fn tailscale_ip() -> Option<String> {
    // async + spawn_blocking: the shell-out must never run on the main thread (it would freeze the
    // whole UI if tailscaled is slow/wedged). This is on the remote-enable fallback path.
    tauri::async_runtime::spawn_blocking(|| {
        let out = run_tailscale(&["ip", "-4"])?;
        String::from_utf8_lossy(&out.stdout)
            .lines()
            .map(|l| l.trim())
            .find(|l| !l.is_empty())
            .map(|s| s.to_string())
    })
    .await
    .ok()
    .flatten()
}

/// This node's MagicDNS name (e.g. my-mac.tailnet-xxxx.ts.net), trailing dot stripped, or None.
#[tauri::command]
fn tailscale_dns_name() -> Option<String> {
    let out = run_tailscale(&["status", "--json"])?;
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).ok()?;
    let name = v.get("Self")?.get("DNSName")?.as_str()?.trim_end_matches('.').to_string();
    if name.is_empty() { None } else { Some(name) }
}

/// Front the LOCALHOST engine port on this node's MagicDNS name over real TLS via Tailscale Serve
/// (V5 Phase 5). Serve proxies `https://<node>.ts.net:443` → `http://127.0.0.1:<port>`, staying
/// private to the tailnet — so the engine itself stays localhost-only (no second listener, more
/// secure than binding the tailnet IP). Returns the `https://<node>.ts.net` URL, or a clear error
/// (the tailnet admin must enable MagicDNS + HTTPS certificates first). [Behavioral verify needs a
/// real tailnet — HUMAN-GATE 5.1.1.]
/// Whether THIS app started a Tailscale Serve handler on :443, so we tear it down on exit (audit M5).
/// Without this the `serve --bg` rule persists across reboots and a same-port restart silently
/// re-proxies a stale target.
static SERVE_ACTIVE: AtomicBool = AtomicBool::new(false);

#[tauri::command]
async fn tailscale_serve_start(app: AppHandle) -> Result<String, String> {
    // Read the engine port from our OWN state, not a WebView-supplied param (audit M17): a buggy or
    // compromised WebView must not be able to point Serve at port 0 or another local service.
    let port = app
        .state::<EngineState>()
        .endpoint
        .lock()
        .unwrap()
        .as_ref()
        .map(|e| e.port)
        .ok_or("engine not ready — no endpoint yet")?;
    // CRITICAL: async + spawn_blocking. `tailscale serve --https=443` provisions a TLS cert, which
    // BLOCKS — and when HTTPS certs aren't enabled in the tailnet it can stall for a long time. As a
    // synchronous Tauri command this ran on the MAIN THREAD and froze the entire UI (beachball). Now
    // it runs off-thread and is timeout-bounded, so on failure it returns Err quickly and the
    // PairingModal falls back to a plain tailnet-IP bind (which needs no certs).
    let dns = tauri::async_runtime::spawn_blocking(move || {
        let target = format!("http://127.0.0.1:{port}");
        run_tailscale_timeout(&["serve", "--bg", "--https=443", &target], Duration::from_secs(10))?;
        tailscale_dns_name() // resolve the MagicDNS name only after serve actually came up
    })
    .await
    .map_err(|e| e.to_string())?;
    match dns {
        Some(d) => {
            SERVE_ACTIVE.store(true, Ordering::SeqCst); // remember to tear it down on exit (M5)
            Ok(format!("https://{d}"))
        }
        None => Err("Couldn't start Tailscale Serve. Is Tailscale running, and are MagicDNS + HTTPS \
                     certificates enabled in your tailnet admin console? Falling back to a direct \
                     tailnet bind."
            .to_string()),
    }
}

/// Hold / release the keep-awake inhibitor (V5 Phase 5). The desktop calls this when remote access
/// is toggled, so the machine stays reachable from a phone while remote is on, and sleeps normally
/// when it's off. Idempotent + ref-counted in `KeepAwake`.
#[tauri::command]
fn set_keep_awake(app: AppHandle, keep: State<keep_awake::KeepAwake>, on: bool) -> Result<(), String> {
    if !on {
        keep.release();
        return Ok(());
    }
    match keep.acquire() {
        Ok(_) => Ok(()), // held, or an expected no-op on a backend-less OS
        Err(e) => {
            // Don't fail silently (audit M19): the machine may sleep and drop the remote link.
            eprintln!("[glaudecode] keep-awake failed: {e}");
            let _ = app.emit("keep-awake-failed", e.clone());
            Err(e)
        }
    }
}

/// Turn off the Tailscale Serve handler on :443 for this node (V5 Phase 5).
#[tauri::command]
fn tailscale_serve_stop() -> Result<(), String> {
    let ok = run_tailscale(&["serve", "--https=443", "off"]).is_some();
    SERVE_ACTIVE.store(false, Ordering::SeqCst); // even on failure: don't loop trying to stop it
    if ok {
        Ok(())
    } else {
        Err("tailscale serve off failed".to_string())
    }
}

/// On app exit, tear down our Serve handler if we started one (audit M5) — otherwise the `:443 --bg`
/// rule persists across reboots and a same-port restart silently re-proxies a stale target.
fn tailscale_serve_stop_on_exit() {
    if SERVE_ACTIVE.swap(false, Ordering::SeqCst) {
        let _ = run_tailscale(&["serve", "--https=443", "off"]);
    }
}

/// The MagicDNS https URL if a Serve handler appears active on this node, else None (V5 Phase 5).
#[tauri::command]
fn tailscale_serve_status() -> Option<String> {
    let out = run_tailscale(&["serve", "status", "--json"])?;
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).ok()?;
    // Serve status JSON shape varies by version; treat any non-empty TCP/Web config as "active".
    let active = v.get("TCP").map(|t| !t.is_null()).unwrap_or(false)
        || v.get("Web").map(|w| !w.is_null()).unwrap_or(false);
    if active { tailscale_dns_name().map(|d| format!("https://{d}")) } else { None }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(PtyRegistry::default())
        .manage(EngineState::default())
        .manage(keep_awake::KeepAwake::default())
        .setup(|app| {
            let handle = app.handle().clone();
            if let Err(e) = spawn_engine(&handle) {
                eprintln!("[glaudecode] engine sidecar failed: {e}");
                let _ = handle.emit("engine-start-failed", e);
            }
            supervise_engine(handle); // watchdog: detect a crash, emit a banner, bounded respawn (M6)
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            pty_set_armed,
            pty_disarm_all,
            pty_list_armed,
            engine_endpoint,
            project_dir,
            os_is_windows,
            tailscale_ip,
            tailscale_dns_name,
            tailscale_serve_start,
            tailscale_serve_stop,
            tailscale_serve_status,
            set_keep_awake
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            // Remove our PreToolUse approval hook so a closed app can never leave a hook
            // behind that gates (and, when the engine is down, denies) tools. Defense in
            // depth — GLAUDECODE_MANAGED scoping already spares non-managed sessions.
            uninstall_approval_hook_on_exit();
            tailscale_serve_stop_on_exit(); // tear down our :443 Serve rule (audit M5)
            app_handle.state::<keep_awake::KeepAwake>().release(); // drop the caffeinate inhibitor
            if let Some(mut child) = app_handle.state::<EngineState>().child.lock().unwrap().take() {
                let _ = child.kill();
            }
            // Kill the PTY children too (audit L6): only the engine child was being killed, so
            // HUP-ignoring / detached pane processes (claude, nohup …) could orphan on exit.
            let registry = app_handle.state::<PtyRegistry>();
            for (_, mut pane) in registry.panes.lock().unwrap().drain() {
                let _ = pane.child.kill();
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
        // Capture the write result (audit M18): a SILENT failure leaves the stale hook in place, so a
        // future closed-app `claude` session fail-closed-denies everything — the exact hazard this fn
        // exists to prevent. We still leave the file untouched on error (no truncation); we just LOG
        // it with the manual remedy.
        if let Err(e) = std::fs::write(&path, out + "\n") {
            eprintln!(
                "[glaudecode] could not strip the approval hook from {}: {e}. If a closed-app \
                 `claude` session is later denied everything, remove it manually: rm {}",
                path.display(),
                path.display()
            );
        }
    }
}

#[cfg(test)]
mod arming_tests {
    // The authoritative remote-input gate (audit M20). These pin the security predicate the whole
    // V5 RCE story rests on: phone keystrokes reach a PTY ONLY when the pane is armed.
    use super::is_armed;
    use std::collections::HashSet;

    fn armed_set(ids: &[&str]) -> HashSet<String> {
        ids.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn unarmed_pane_is_dropped() {
        // No pane armed → every write/resize must be dropped (the default-OFF posture).
        let armed = armed_set(&[]);
        assert!(!is_armed(&armed, "pane-1"));
    }

    #[test]
    fn armed_pane_is_allowed_others_still_gated() {
        let armed = armed_set(&["pane-1"]);
        assert!(is_armed(&armed, "pane-1"));
        assert!(!is_armed(&armed, "pane-2")); // arming one pane never arms another
    }

    #[test]
    fn disarm_clears_the_gate() {
        let mut armed = armed_set(&["pane-1", "pane-2"]);
        armed.remove("pane-1"); // pty_set_armed(false)
        assert!(!is_armed(&armed, "pane-1"));
        assert!(is_armed(&armed, "pane-2"));
    }

    #[test]
    fn disarm_all_leaves_nothing_armed() {
        let mut armed = armed_set(&["a", "b", "c"]);
        let previously: Vec<String> = armed.iter().cloned().collect(); // pty_disarm_all return value
        armed.clear();
        assert_eq!(previously.len(), 3);
        for id in ["a", "b", "c"] {
            assert!(!is_armed(&armed, id));
        }
    }

    #[test]
    fn dead_pane_cleanup_removes_from_armed() {
        // pty_kill removes a killed pane from the armed set so a reused id can't inherit arming.
        let mut armed = armed_set(&["pane-1"]);
        armed.remove("pane-1");
        assert!(!is_armed(&armed, "pane-1"));
    }
}
