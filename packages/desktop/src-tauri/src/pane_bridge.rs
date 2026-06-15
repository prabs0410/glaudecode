// Pane bridge — tees each pane's PTY output from the Rust core to the engine, which relays it to
// phones over /term-ws (V5 Phase 1), and (V5 Phase 2) carries the reverse: a phone's keystrokes
// come back from the engine and ARM frames go out. The PTY reader runs in a blocking std::thread,
// so this uses a SYNCHRONOUS WebSocket client (tungstenite). Frames match
// `packages/engine/src/bridgeProtocol.ts`:
//   [op:1][paneIdLen:1][paneId utf8 ...][payload ...]
//   out: 0=OUTPUT 1=SIZE 2=META 3=CLOSE 5=ARM   in: 4=INPUT
//
// Phase 2 uses TWO simplex connections so the high-volume output path stays a simple, low-latency
// channel-fed writer (unchanged from Phase 1) and the low-volume input path is a simple blocking
// reader — neither has to interleave reads + writes on one socket:
//   - OUTPUT/SIZE/META/CLOSE/ARM  → /pane-bridge        (channel-fed writer, `start`/`pump`)
//   - INPUT                       ← /pane-input-bridge   (blocking reader, `start_input`/`pump_input`)
//
// The output channel is bounded with try_send (drop on full), so a slow/disconnected engine NEVER
// stalls the local terminal — the engine's per-pane ring buffer replays the screen on (re)attach.

use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::thread;
use std::time::Duration;

use tungstenite::{connect, Message};

/// Pre-encoded bridge frames are pushed here from the PTY reader threads.
pub type BridgeTx = SyncSender<Vec<u8>>;

const OP_OUTPUT: u8 = 0;
const OP_SIZE: u8 = 1;
const OP_META: u8 = 2;
const OP_CLOSE: u8 = 3;
const OP_INPUT: u8 = 4;
const OP_ARM: u8 = 5;

fn frame(op: u8, pane_id: &str, payload: &[u8]) -> Vec<u8> {
    let id = pane_id.as_bytes();
    let id = &id[..id.len().min(255)];
    let mut v = Vec::with_capacity(2 + id.len() + payload.len());
    v.push(op);
    v.push(id.len() as u8);
    v.extend_from_slice(id);
    v.extend_from_slice(payload);
    v
}

pub fn encode_output(pane_id: &str, data: &[u8]) -> Vec<u8> {
    frame(OP_OUTPUT, pane_id, data)
}
pub fn encode_size(pane_id: &str, cols: u16, rows: u16) -> Vec<u8> {
    let mut p = Vec::with_capacity(4);
    p.extend_from_slice(&cols.to_be_bytes());
    p.extend_from_slice(&rows.to_be_bytes());
    frame(OP_SIZE, pane_id, &p)
}
pub fn encode_meta(pane_id: &str, title: &str) -> Vec<u8> {
    frame(OP_META, pane_id, title.as_bytes())
}
pub fn encode_close(pane_id: &str) -> Vec<u8> {
    frame(OP_CLOSE, pane_id, &[])
}
/// Rust → engine: mirror a pane's "remote input allowed" arming so the engine can gate input early
/// + show armed state on the phone (V5 Phase 2). The Rust core remains authoritative on arming.
pub fn encode_arm(pane_id: &str, armed: bool) -> Vec<u8> {
    frame(OP_ARM, pane_id, &[if armed { 1 } else { 0 }])
}

/// Decode an inbound bridge frame into (op, paneId, payload). Used for engine → Rust INPUT frames.
/// Returns None on a malformed/truncated frame (dropped, never panics on hostile input).
fn decode(buf: &[u8]) -> Option<(u8, String, Vec<u8>)> {
    if buf.len() < 2 {
        return None;
    }
    let op = buf[0];
    let id_len = buf[1] as usize;
    if buf.len() < 2 + id_len {
        return None;
    }
    let pane_id = String::from_utf8_lossy(&buf[2..2 + id_len]).into_owned();
    let payload = buf[2 + id_len..].to_vec();
    Some((op, pane_id, payload))
}

/// Start the bridge: spawn a thread that connects to the engine's /pane-bridge, authenticates with
/// the engine bearer token, and pumps pre-encoded frames from the returned sender. Reconnects with
/// a short backoff. Returns the sender (cloned into each PTY reader thread).
pub fn start(port: u16, token: String) -> BridgeTx {
    let (tx, rx) = sync_channel::<Vec<u8>>(2048);
    thread::Builder::new()
        .name("pane-bridge".into())
        .spawn(move || pump(port, token, rx))
        .ok();
    tx
}

fn pump(port: u16, token: String, rx: Receiver<Vec<u8>>) {
    let url = format!("ws://127.0.0.1:{port}/pane-bridge");
    let auth = serde_json::json!({ "type": "auth", "token": token }).to_string();
    loop {
        match connect(&url) {
            Ok((mut ws, _resp)) => {
                if ws.send(Message::Text(auth.clone().into())).is_err() {
                    let _ = ws.close(None);
                } else {
                    // Drain frames → WS until the socket dies; then fall through to reconnect.
                    while let Ok(buf) = rx.recv() {
                        if ws.send(Message::Binary(buf.into())).is_err() {
                            break;
                        }
                    }
                    // rx closed (app shutting down) vs send error: if rx is closed, recv() keeps
                    // erroring, so a quick probe distinguishes "shutdown" (exit) from "reconnect".
                    if rx.try_recv().is_err() && is_disconnected(&rx) {
                        return;
                    }
                }
            }
            Err(_) => {}
        }
        // Drain any backlog we can't deliver while disconnected, so memory stays bounded and the
        // phone resyncs from the engine ring buffer on reconnect rather than replaying a huge gap.
        while rx.try_recv().is_ok() {}
        thread::sleep(Duration::from_secs(2));
    }
}

/// True once the sending half has been dropped (app shutdown) — recv would error forever.
fn is_disconnected(rx: &Receiver<Vec<u8>>) -> bool {
    matches!(rx.try_recv(), Err(std::sync::mpsc::TryRecvError::Disconnected))
}

/// Start the INPUT bridge (V5 Phase 2): spawn a thread that connects to /pane-input-bridge,
/// authenticates with the engine bearer token, and blocking-reads INPUT frames the engine pushes
/// (a phone's keystrokes, already gated by the engine for terminal scope + an armed pane). Each
/// decoded INPUT calls `on_input(paneId, bytes)`, which re-checks arming authoritatively before
/// writing the PTY. Reconnects with a short backoff. The thread is a daemon — it dies with the
/// process on app exit (the engine child is killed there).
pub fn start_input<F>(port: u16, token: String, on_input: F)
where
    F: Fn(&str, &[u8]) + Send + 'static,
{
    thread::Builder::new()
        .name("pane-input-bridge".into())
        .spawn(move || pump_input(port, token, on_input))
        .ok();
}

fn pump_input<F>(port: u16, token: String, on_input: F)
where
    F: Fn(&str, &[u8]),
{
    let url = format!("ws://127.0.0.1:{port}/pane-input-bridge");
    let auth = serde_json::json!({ "type": "auth", "token": token }).to_string();
    loop {
        if let Ok((mut ws, _resp)) = connect(&url) {
            if ws.send(Message::Text(auth.clone().into())).is_ok() {
                // Block reading keystroke frames until the socket dies, then reconnect.
                loop {
                    match ws.read() {
                        Ok(Message::Binary(b)) => {
                            if let Some((op, pane_id, payload)) = decode(&b) {
                                if op == OP_INPUT {
                                    on_input(&pane_id, &payload);
                                }
                            }
                        }
                        Ok(Message::Close(_)) | Err(_) => break,
                        Ok(_) => {} // text / ping / pong — ignore
                    }
                }
            }
            let _ = ws.close(None);
        }
        thread::sleep(Duration::from_secs(2));
    }
}
