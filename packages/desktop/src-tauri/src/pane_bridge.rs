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

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError, SyncSender};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use tungstenite::{connect, Message};

/// Pre-encoded bridge frames are pushed here from the PTY reader threads.
pub type BridgeTx = SyncSender<Vec<u8>>;

const OP_OUTPUT: u8 = 0;
const OP_SIZE: u8 = 1;
const OP_META: u8 = 2;
const OP_CLOSE: u8 = 3;
// Inbound (engine -> Rust) ops the input pump dispatches; pub so lib.rs can match them.
pub const OP_INPUT: u8 = 4;
const OP_ARM: u8 = 5;
pub const OP_RESIZE: u8 = 6;

fn frame(op: u8, pane_id: &str, payload: &[u8]) -> Vec<u8> {
    // Truncate an over-long id at a UTF-8 CHAR boundary, never a raw byte (audit L12) — a raw cut
    // could split a codepoint and decode to a different string than the engine sees. paneIds are
    // short ASCII UUIDs in practice, so this never actually fires.
    let bytes = pane_id.as_bytes();
    let id = if bytes.len() <= 255 {
        bytes
    } else {
        let mut end = 255;
        while end > 0 && !pane_id.is_char_boundary(end) {
            end -= 1;
        }
        &bytes[..end]
    };
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
/// a short backoff. Returns the sender. `stop` retires the pump on an engine respawn so it stops
/// reconnecting to the dead port instead of looping forever (mirror of the input pump's stop flag).
pub fn start<F>(port: u16, token: String, stop: Arc<AtomicBool>, on_connect: F) -> BridgeTx
where
    F: Fn() -> Vec<Vec<u8>> + Send + 'static,
{
    let (tx, rx) = sync_channel::<Vec<u8>>(2048);
    thread::Builder::new()
        .name("pane-bridge".into())
        .spawn(move || pump(port, token, rx, stop, on_connect))
        .ok();
    tx
}

fn pump<F>(port: u16, token: String, rx: Receiver<Vec<u8>>, stop: Arc<AtomicBool>, on_connect: F)
where
    F: Fn() -> Vec<Vec<u8>>,
{
    let url = format!("ws://127.0.0.1:{port}/pane-bridge");
    let auth = serde_json::json!({ "type": "auth", "token": token }).to_string();
    loop {
        if stop.load(Ordering::Relaxed) {
            return; // retired by a respawn — stop reconnecting to a dead port (output-pump GAP)
        }
        match connect(&url) {
            Ok((mut ws, _resp)) => {
                if ws.send(Message::Text(auth.clone().into())).is_err() {
                    let _ = ws.close(None);
                } else {
                    // Re-sync the engine mirror after every (re)connect: replay META+SIZE+ARM for each
                    // live pane, so a pane armed BEFORE the blip stays typeable — the engine's input
                    // gate needs the pane present + armed in its mirror (audit M13).
                    let mut alive = true;
                    for frame in on_connect() {
                        if ws.send(Message::Binary(frame.into())).is_err() {
                            alive = false;
                            break;
                        }
                    }
                    // Drain frames → WS until the socket dies or we're retired; then reconnect/exit.
                    // recv_timeout (not recv) so a respawn's `stop` is honored even while idle, instead
                    // of blocking on recv() until the next PTY byte arrives.
                    while alive {
                        if stop.load(Ordering::Relaxed) {
                            return;
                        }
                        match rx.recv_timeout(Duration::from_millis(500)) {
                            Ok(buf) => {
                                if ws.send(Message::Binary(buf.into())).is_err() {
                                    break;
                                }
                            }
                            Err(RecvTimeoutError::Timeout) => {} // idle — loop to re-check `stop`
                            Err(RecvTimeoutError::Disconnected) => return, // app shutdown
                        }
                    }
                }
            }
            Err(_) => {}
        }
        if stop.load(Ordering::Relaxed) {
            return;
        }
        // Drain any backlog we can't deliver while disconnected, so memory stays bounded and the
        // phone resyncs from the engine ring buffer on reconnect rather than replaying a huge gap.
        while rx.try_recv().is_ok() {}
        if is_disconnected(&rx) {
            return; // all senders dropped (app shutting down) → don't busy-reconnect forever
        }
        thread::sleep(Duration::from_secs(2));
    }
}

/// True once the sending half has been dropped (app shutdown) — recv would error forever.
fn is_disconnected(rx: &Receiver<Vec<u8>>) -> bool {
    matches!(rx.try_recv(), Err(std::sync::mpsc::TryRecvError::Disconnected))
}

/// Start the INPUT bridge (V5 Phase 2/4): spawn a thread that connects to /pane-input-bridge,
/// authenticates with the engine bearer token, and blocking-reads inbound frames the engine pushes
/// (a phone's keystrokes / resizes, already gated by the engine for terminal scope + an armed pane).
/// Each decoded frame calls `on_frame(op, paneId, payload)`, which re-checks arming authoritatively
/// before touching the PTY. Reconnects with a short backoff. The thread exits when `stop` is set (on
/// an engine respawn) — otherwise the old thread would reconnect-loop forever against the dead port
/// (audit M6 GAP B); it's also a daemon, so it dies with the process on app exit.
pub fn start_input<F>(port: u16, token: String, stop: Arc<AtomicBool>, on_frame: F)
where
    F: Fn(u8, &str, &[u8]) + Send + 'static,
{
    thread::Builder::new()
        .name("pane-input-bridge".into())
        .spawn(move || pump_input(port, token, stop, on_frame))
        .ok();
}

fn pump_input<F>(port: u16, token: String, stop: Arc<AtomicBool>, on_frame: F)
where
    F: Fn(u8, &str, &[u8]),
{
    let url = format!("ws://127.0.0.1:{port}/pane-input-bridge");
    let auth = serde_json::json!({ "type": "auth", "token": token }).to_string();
    loop {
        if stop.load(Ordering::Relaxed) {
            return; // retired by a respawn — stop reconnecting to a dead port
        }
        if let Ok((mut ws, _resp)) = connect(&url) {
            if ws.send(Message::Text(auth.clone().into())).is_ok() {
                // Block reading inbound frames until the socket dies, then reconnect.
                loop {
                    match ws.read() {
                        Ok(Message::Binary(b)) => {
                            if let Some((op, pane_id, payload)) = decode(&b) {
                                on_frame(op, &pane_id, &payload);
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

#[cfg(test)]
mod tests {
    // The bridge decoder is the parser for engine -> Rust INPUT/RESIZE frames — hostile input
    // (a buggy/compromised engine, or a phone that reached the input path) must NEVER panic and must
    // round-trip a well-formed frame (audit M20).
    use super::*;

    #[test]
    fn decode_rejects_truncated_frames() {
        assert!(decode(&[]).is_none()); // no op byte
        assert!(decode(&[OP_INPUT]).is_none()); // missing length byte
        // id_len claims 5 but only 2 id bytes follow → truncated, dropped (not a panic / OOB read)
        assert!(decode(&[OP_INPUT, 5, b'a', b'b']).is_none());
    }

    #[test]
    fn decode_reads_op_paneid_payload() {
        let buf = [OP_INPUT, 3, b'a', b'b', b'c', b'h', b'i'];
        let (op, id, payload) = decode(&buf).unwrap();
        assert_eq!(op, OP_INPUT);
        assert_eq!(id, "abc");
        assert_eq!(payload, b"hi");
    }

    #[test]
    fn decode_handles_empty_paneid_and_empty_payload() {
        let (op, id, payload) = decode(&[OP_RESIZE, 0]).unwrap();
        assert_eq!(op, OP_RESIZE);
        assert_eq!(id, "");
        assert!(payload.is_empty());
    }

    #[test]
    fn decode_never_panics_on_non_utf8_paneid() {
        // Invalid UTF-8 in the id → from_utf8_lossy substitutes U+FFFD; the payload still decodes.
        let buf = [OP_INPUT, 2, 0xff, 0xfe, b'x'];
        let (_, id, payload) = decode(&buf).unwrap();
        assert!(id.contains('\u{fffd}'));
        assert_eq!(payload, b"x");
    }

    #[test]
    fn encoded_frame_round_trips_through_decode() {
        let f = encode_arm("pane-1", true);
        let (op, id, payload) = decode(&f).unwrap();
        assert_eq!(op, OP_ARM);
        assert_eq!(id, "pane-1");
        assert_eq!(payload, vec![1]);
    }

    #[test]
    fn frame_truncates_an_overlong_id_at_a_char_boundary(/* audit L12 */) {
        // 200 × 2-byte 'é' = 400 bytes > 255. A raw cut at 255 would split a codepoint; we must cut
        // at a boundary so the decoded id is valid UTF-8 (no U+FFFD from a split).
        let long = "é".repeat(200);
        let f = encode_meta(&long, "t");
        let id_len = f[1] as usize;
        assert!(id_len <= 255 && id_len % 2 == 0); // whole 2-byte chars only
        let (_, id, _) = decode(&f).unwrap();
        assert!(!id.contains('\u{fffd}')); // never a split-codepoint replacement char
        assert!(id.chars().all(|c| c == 'é'));
    }
}
