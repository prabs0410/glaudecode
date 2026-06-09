import { describe, expect, test } from "bun:test";
import { parseOsc133, parseOsc7 } from "../src/osc";

describe("parseOsc133", () => {
  test("maps the semantic markers", () => {
    expect(parseOsc133("A")).toEqual({ kind: "prompt-start" });
    expect(parseOsc133("B")).toEqual({ kind: "command-start" });
    expect(parseOsc133("C")).toEqual({ kind: "pre-exec" });
  });

  test("D carries the exit code", () => {
    expect(parseOsc133("D;0")).toEqual({ kind: "command-done", exitCode: 0 });
    expect(parseOsc133("D;130")).toEqual({ kind: "command-done", exitCode: 130 });
  });

  test("D without a code yields undefined exit", () => {
    expect(parseOsc133("D")).toEqual({ kind: "command-done", exitCode: undefined });
    expect(parseOsc133("D;")).toEqual({ kind: "command-done", exitCode: undefined });
  });

  test("unknown payloads are 'other'", () => {
    expect(parseOsc133("P;cwd=/x")).toEqual({ kind: "other" });
    expect(parseOsc133("")).toEqual({ kind: "other" });
  });
});

describe("parseOsc7", () => {
  test("extracts the path from file://host/path", () => {
    expect(parseOsc7("file://Thorfinn/Users/me/proj")).toBe("/Users/me/proj");
    expect(parseOsc7("file:///Users/me/proj")).toBe("/Users/me/proj");
  });

  test("decodes percent-encoding", () => {
    expect(parseOsc7("file://h/Users/me/My%20Project")).toBe("/Users/me/My Project");
  });

  test("returns null for non-file payloads", () => {
    expect(parseOsc7("https://x/y")).toBeNull();
    expect(parseOsc7("garbage")).toBeNull();
  });
});
