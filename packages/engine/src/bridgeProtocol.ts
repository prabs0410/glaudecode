// Multiplexed Rust-core → engine "pane-bridge" frames (V5 Phase 1). The Rust core tees every
// pane's PTY output to the engine over ONE localhost WebSocket, so each frame carries the paneId.
// This is distinct from termProtocol (the per-pane engine→cockpit channel, no paneId). Binary:
//   [op:1][paneIdLen:1][paneId utf8 ...][payload ...]
//   0x00 OUTPUT : payload = raw PTY bytes
//   0x01 SIZE   : payload = cols (uint16 BE), rows (uint16 BE)
//   0x02 META   : payload = title (utf8) — human label for the cockpit pane list
//   0x03 CLOSE  : payload = empty — the pane ended
// Pure codec, unit-tested; the engine decodes these into PaneHub calls, the Rust side encodes them.

export const BridgeOp = { OUTPUT: 0x00, SIZE: 0x01, META: 0x02, CLOSE: 0x03 } as const;

function frame(op: number, paneId: string, payload: Uint8Array): Uint8Array {
  const id = new TextEncoder().encode(paneId);
  if (id.length > 255) throw new Error("paneId too long for bridge frame");
  const f = new Uint8Array(2 + id.length + payload.length);
  f[0] = op;
  f[1] = id.length;
  f.set(id, 2);
  f.set(payload, 2 + id.length);
  return f;
}

export function encodeBridgeOutput(paneId: string, data: Uint8Array): Uint8Array {
  return frame(BridgeOp.OUTPUT, paneId, data);
}
export function encodeBridgeSize(paneId: string, cols: number, rows: number): Uint8Array {
  const p = new Uint8Array(4);
  const dv = new DataView(p.buffer);
  dv.setUint16(0, cols & 0xffff, false);
  dv.setUint16(2, rows & 0xffff, false);
  return frame(BridgeOp.SIZE, paneId, p);
}
export function encodeBridgeMeta(paneId: string, title: string): Uint8Array {
  return frame(BridgeOp.META, paneId, new TextEncoder().encode(title));
}
export function encodeBridgeClose(paneId: string): Uint8Array {
  return frame(BridgeOp.CLOSE, paneId, new Uint8Array(0));
}

export type BridgeFrame =
  | { type: "output"; paneId: string; data: Uint8Array }
  | { type: "size"; paneId: string; cols: number; rows: number }
  | { type: "meta"; paneId: string; title: string }
  | { type: "close"; paneId: string }
  | { type: "unknown"; op: number };

export function decodeBridgeFrame(buf: Uint8Array): BridgeFrame {
  if (buf.length < 2) return { type: "unknown", op: buf.length ? buf[0] : -1 };
  const op = buf[0];
  const idLen = buf[1];
  if (buf.length < 2 + idLen) return { type: "unknown", op };
  const paneId = new TextDecoder().decode(buf.subarray(2, 2 + idLen));
  const payload = buf.subarray(2 + idLen);
  const dv = () => new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  switch (op) {
    case BridgeOp.OUTPUT:
      return { type: "output", paneId, data: payload };
    case BridgeOp.SIZE:
      if (payload.length < 4) return { type: "unknown", op };
      return { type: "size", paneId, cols: dv().getUint16(0, false), rows: dv().getUint16(2, false) };
    case BridgeOp.META:
      return { type: "meta", paneId, title: new TextDecoder().decode(payload) };
    case BridgeOp.CLOSE:
      return { type: "close", paneId };
    default:
      return { type: "unknown", op };
  }
}
