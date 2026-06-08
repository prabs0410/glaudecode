// GlaudeCode desktop core.
//
// Two responsibilities:
//   1. PTY bridge — run a real shell (and Claude Code) in the xterm.js pane.
//   2. Engine sidecar — spawn the host-agnostic @glaudecode/engine as a Bun child
//      process, read its {port, token} handshake, and expose the endpoint + the
//      project directory to the WebView. All Claude Code data flows through the
//      engine's RPC (Constitution Principle XI); the core never reads sessions.

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use tauri::{AppHandle, Emitter, Manager, State};

// ---------- PTY ----------

#[derive(Default)]
struct PtyState {
    writer: Mutex<Option<Box<dyn Write + Send>>>,
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
}

#[tauri::command]
fn pty_spawn(app: AppHandle, state: State<PtyState>, rows: u16, cols: u16) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
    let mut cmd = CommandBuilder::new(shell);
    cmd.arg("-l");
    if let Ok(cwd) = std::env::current_dir() {
        cmd.cwd(cwd);
    }
    cmd.env("TERM", "xterm-256color");

    let _child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    *state.writer.lock().unwrap() = Some(writer);
    *state.master.lock().unwrap() = Some(pair.master);

    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let _ = app.emit("pty-output", buf[..n].to_vec());
                }
                Err(_) => break,
            }
        }
        let _ = app.emit("pty-exit", ());
    });

    Ok(())
}

#[tauri::command]
fn pty_write(state: State<PtyState>, data: String) -> Result<(), String> {
    if let Some(w) = state.writer.lock().unwrap().as_mut() {
        w.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        w.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn pty_resize(state: State<PtyState>, rows: u16, cols: u16) -> Result<(), String> {
    if let Some(m) = state.master.lock().unwrap().as_ref() {
        m.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;
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
        .manage(PtyState::default())
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
