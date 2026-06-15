import { describe, expect, test } from "bun:test";
import { decodeFrame, encodeAck, encodeInput, encodeOutput, encodeSize, TermOp } from "../src/termProtocol";

describe("termProtocol", () => {
  test("OUTPUT round-trips arbitrary bytes (incl. zero/high bytes)", () => {
    const data = new Uint8Array([0, 27, 91, 50, 74, 255, 13, 10]); // ESC [ 2 J ... CR LF
    const frame = encodeOutput(data);
    expect(frame[0]).toBe(TermOp.OUTPUT);
    const d = decodeFrame(frame);
    expect(d.type).toBe("output");
    if (d.type === "output") expect([...d.data]).toEqual([...data]);
  });

  test("OUTPUT of empty payload decodes to empty data", () => {
    const d = decodeFrame(encodeOutput(new Uint8Array(0)));
    expect(d.type).toBe("output");
    if (d.type === "output") expect(d.data.length).toBe(0);
  });

  test("SIZE round-trips cols/rows", () => {
    const d = decodeFrame(encodeSize(213, 51));
    expect(d).toEqual({ type: "size", cols: 213, rows: 51 });
  });

  test("ACK round-trips a large byte count (>16-bit)", () => {
    const d = decodeFrame(encodeAck(5_000_000));
    expect(d).toEqual({ type: "ack", bytes: 5_000_000 });
  });

  test("INPUT round-trips keystroke bytes (phone -> server, V5 Phase 2)", () => {
    const keys = new Uint8Array([0x03, 0x1b, 0x5b, 0x41, 13]); // Ctrl-C, ESC [ A (up arrow), CR
    const frame = encodeInput(keys);
    expect(frame[0]).toBe(TermOp.INPUT);
    const d = decodeFrame(frame);
    expect(d.type).toBe("input");
    if (d.type === "input") expect([...d.data]).toEqual([...keys]);
  });

  test("INPUT of empty payload decodes to empty data", () => {
    const d = decodeFrame(encodeInput(new Uint8Array(0)));
    expect(d.type).toBe("input");
    if (d.type === "input") expect(d.data.length).toBe(0);
  });

  test("unknown opcode is reported, not thrown", () => {
    expect(decodeFrame(new Uint8Array([0x7f, 1, 2]))).toEqual({ type: "unknown", op: 0x7f });
    expect(decodeFrame(new Uint8Array(0))).toEqual({ type: "unknown", op: -1 });
  });

  test("truncated SIZE/ACK frames don't mis-decode", () => {
    expect(decodeFrame(new Uint8Array([TermOp.SIZE, 0, 1]))).toEqual({ type: "unknown", op: TermOp.SIZE });
    expect(decodeFrame(new Uint8Array([TermOp.ACK, 0]))).toEqual({ type: "unknown", op: TermOp.ACK });
  });

  test("decode works on a subarray (non-zero byteOffset)", () => {
    const backing = new Uint8Array([99, 99, ...encodeSize(80, 24)]);
    const view = backing.subarray(2);
    expect(decodeFrame(view)).toEqual({ type: "size", cols: 80, rows: 24 });
  });
});
