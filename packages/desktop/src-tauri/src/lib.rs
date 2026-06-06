// GlaudeCode desktop — PTY bridge spike.
// Opens a real PTY running the user's login shell, streams output bytes to the
// WebView via `pty-output` events, accepts input via `pty_write`, and resizes
// via `pty_resize`. The frontend renders the stream with xterm.js. Run `claude`
// inside the resulting terminal to validate Claude Code's TUI rendering.

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::sync::Mutex;
use std::thread;
use tauri::{AppHandle, Emitter, State};

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
                    // Emit raw bytes; the frontend decodes with a streaming
                    // TextDecoder so multibyte UTF-8 split across reads is safe.
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(PtyState::default())
        .invoke_handler(tauri::generate_handler![pty_spawn, pty_write, pty_resize])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
