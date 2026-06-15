// Pane bridge (V5 Phase 1) — tees each pane's PTY output from the Rust core to the engine, which
// relays it to phones over /term-ws. The PTY reader runs in a blocking std::thread, so this uses a
// SYNCHRONOUS WebSocket client (tungstenite) fed by a bounded std::sync::mpsc channel — no async
// runtime needed. Frames are pre-encoded here and match `packages/engine/src/bridgeProtocol.ts`:
//   [op:1][paneIdLen:1][paneId utf8 ...][payload ...]   op: 0=OUTPUT 1=SIZE 2=META 3=CLOSE
//
// The channel is bounded with try_send (drop on full), so a slow/disconnected engine NEVER stalls
// the local terminal — the engine's per-pane ring buffer replays the current screen on (re)attach.

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
