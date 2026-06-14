// Binary wire protocol for the terminal mirror (V5 Phase 1). One pane per WebSocket, so frames
// carry no paneId — the channel itself is the addressing. ttyd-style: 1-byte opcode + payload.
// Deliberately NOT xterm.js AttachAddon (no resize, no replay). Pure codec — unit-tested here;
// the PaneHub frames output/size with it and decodes client ACKs for flow control.
//
//   0x00 OUTPUT  server -> client : raw PTY bytes
//   0x01 SIZE    server -> client : cols (uint16 BE), rows (uint16 BE) — phone renders at this size
//   0x02 ACK     client -> server : uint32 BE total bytes consumed (drives flow control)

export const TermOp = { OUTPUT: 0x00, SIZE: 0x01, ACK: 0x02 } as const;

export function encodeOutput(data: Uint8Array): Uint8Array {
  const f = new Uint8Array(1 + data.length);
  f[0] = TermOp.OUTPUT;
  f.set(data, 1);
  return f;
}

export function encodeSize(cols: number, rows: number): Uint8Array {
  const f = new Uint8Array(5);
  f[0] = TermOp.SIZE;
  const dv = new DataView(f.buffer);
  dv.setUint16(1, cols & 0xffff, false);
  dv.setUint16(3, rows & 0xffff, false);
  return f;
}

export function encodeAck(bytes: number): Uint8Array {
  const f = new Uint8Array(5);
  f[0] = TermOp.ACK;
  new DataView(f.buffer).setUint32(1, bytes >>> 0, false);
  return f;
}

export type TermFrame =
  | { type: "output"; data: Uint8Array }
  | { type: "size"; cols: number; rows: number }
  | { type: "ack"; bytes: number }
  | { type: "unknown"; op: number };

export function decodeFrame(buf: Uint8Array): TermFrame {
  if (buf.length < 1) return { type: "unknown", op: -1 };
  const op = buf[0];
  const dv = () => new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (op === TermOp.OUTPUT) return { type: "output", data: buf.subarray(1) };
  if (op === TermOp.SIZE && buf.length >= 5) return { type: "size", cols: dv().getUint16(1, false), rows: dv().getUint16(3, false) };
  if (op === TermOp.ACK && buf.length >= 5) return { type: "ack", bytes: dv().getUint32(1, false) };
  return { type: "unknown", op };
}
