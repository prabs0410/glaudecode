import { describe, expect, test } from "bun:test";
import {
  decodeBridgeFrame,
  encodeBridgeArm,
  encodeBridgeClose,
  encodeBridgeInput,
  encodeBridgeMeta,
  encodeBridgeOutput,
  encodeBridgeResize,
  encodeBridgeSize,
} from "../src/bridgeProtocol";

const PANE = "a1b2c3d4-0000-4444-8888-abcdef012345"; // a uuid-shaped paneId

describe("bridgeProtocol", () => {
  test("OUTPUT carries paneId + raw bytes", () => {
    const data = new Uint8Array([0, 27, 91, 255, 10]);
    const d = decodeBridgeFrame(encodeBridgeOutput(PANE, data));
    expect(d.type).toBe("output");
    if (d.type === "output") {
      expect(d.paneId).toBe(PANE);
      expect([...d.data]).toEqual([...data]);
    }
  });

  test("SIZE round-trips cols/rows with paneId", () => {
    expect(decodeBridgeFrame(encodeBridgeSize(PANE, 200, 60))).toEqual({
      type: "size",
      paneId: PANE,
      cols: 200,
      rows: 60,
    });
  });

  test("META carries a unicode title", () => {
    const d = decodeBridgeFrame(encodeBridgeMeta(PANE, "feat/✨ build"));
    expect(d).toEqual({ type: "meta", paneId: PANE, title: "feat/✨ build" });
  });

  test("CLOSE carries just the paneId", () => {
    expect(decodeBridgeFrame(encodeBridgeClose(PANE))).toEqual({ type: "close", paneId: PANE });
  });

  test("INPUT carries paneId + raw keystroke bytes (engine -> Rust, V5 Phase 2)", () => {
    const keys = new Uint8Array([0x03, 13, 0, 255]); // Ctrl-C, CR, plus zero/high bytes
    const d = decodeBridgeFrame(encodeBridgeInput(PANE, keys));
    expect(d.type).toBe("input");
    if (d.type === "input") {
      expect(d.paneId).toBe(PANE);
      expect([...d.data]).toEqual([...keys]);
    }
  });

  test("ARM round-trips the armed flag (Rust -> engine, V5 Phase 2)", () => {
    expect(decodeBridgeFrame(encodeBridgeArm(PANE, true))).toEqual({ type: "arm", paneId: PANE, armed: true });
    expect(decodeBridgeFrame(encodeBridgeArm(PANE, false))).toEqual({ type: "arm", paneId: PANE, armed: false });
  });

  test("RESIZE round-trips cols/rows (engine -> Rust, V5 Phase 4)", () => {
    expect(decodeBridgeFrame(encodeBridgeResize(PANE, 100, 30))).toEqual({ type: "resize", paneId: PANE, cols: 100, rows: 30 });
  });

  test("truncated / unknown frames don't mis-decode", () => {
    expect(decodeBridgeFrame(new Uint8Array(0))).toEqual({ type: "unknown", op: -1 });
    expect(decodeBridgeFrame(new Uint8Array([0x00]))).toEqual({ type: "unknown", op: 0x00 }); // missing idLen
    expect(decodeBridgeFrame(new Uint8Array([0x7e, 2, 65]))).toEqual({ type: "unknown", op: 0x7e }); // idLen says 2, only 1 byte
  });

  test("decode works on a subarray (non-zero byteOffset)", () => {
    const backing = new Uint8Array([1, 2, 3, ...encodeBridgeSize(PANE, 80, 24)]);
    expect(decodeBridgeFrame(backing.subarray(3))).toEqual({ type: "size", paneId: PANE, cols: 80, rows: 24 });
  });
});
