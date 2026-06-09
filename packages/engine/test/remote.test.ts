import { describe, expect, test } from "bun:test";
import { frameEvent, parseFrame } from "../src/remote";

describe("remote framing", () => {
  test("frameEvent round-trips through parseFrame", () => {
    const raw = frameEvent("approvals", [{ id: "a" }], "2026-06-09T00:00:00Z");
    expect(parseFrame(raw)).toEqual({ type: "approvals", payload: [{ id: "a" }], at: "2026-06-09T00:00:00Z" });
  });

  test("parseFrame rejects non-JSON and typeless frames", () => {
    expect(parseFrame("{not json")).toBeNull();
    expect(parseFrame(JSON.stringify({ payload: 1 }))).toBeNull();
  });
});
