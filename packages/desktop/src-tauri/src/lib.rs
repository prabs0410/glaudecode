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
            let mut b = CommandBuilder::new(shell);
            b.arg("-l");
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
