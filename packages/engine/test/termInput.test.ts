import { describe, expect, test } from "bun:test";
import { ctrlByte, wrapForPaste } from "../src/termInput";

describe("wrapForPaste (V5 Phase 4)", () => {
  test("single-line text passes through unchanged", () => {
    expect(wrapForPaste("ls -la")).toBe("ls -la");
  });
  test("empty string passes through unchanged", () => {
    expect(wrapForPaste("")).toBe("");
  });
  test("multi-line text is wrapped in bracketed paste", () => {
    expect(wrapForPaste("line1\nline2")).toBe("\x1b[200~line1\nline2\x1b[201~");
  });
  test("trailing newline counts as multi-line", () => {
    expect(wrapForPaste("one\n")).toBe("\x1b[200~one\n\x1b[201~");
  });
});

describe("ctrlByte (V5 Phase 4)", () => {
  test("Ctrl-C is 0x03 (from either case)", () => {
    expect(ctrlByte("c")).toBe("\x03");
    expect(ctrlByte("C")).toBe("\x03");
  });
  test("Ctrl-D / Ctrl-A / Ctrl-Z map correctly", () => {
    expect(ctrlByte("d")).toBe("\x04");
    expect(ctrlByte("a")).toBe("\x01");
    expect(ctrlByte("z")).toBe("\x1a");
  });
  test("Ctrl-[ is ESC (0x1b)", () => {
    expect(ctrlByte("[")).toBe("\x1b");
  });
  test("non-mappable / empty / multi-char inputs return empty", () => {
    expect(ctrlByte("")).toBe("");
    expect(ctrlByte("ab")).toBe("");
    expect(ctrlByte("1")).toBe(""); // digits have no control code
  });
});
