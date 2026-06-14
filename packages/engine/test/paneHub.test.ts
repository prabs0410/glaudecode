import { describe, expect, test } from "bun:test";
import { PaneHub, type TermSubscriber } from "../src/paneHub";
import { decodeFrame, type TermFrame } from "../src/termProtocol";

function makeSub() {
  const frames: TermFrame[] = [];
  let closed = false;
  const sub: TermSubscriber = {
    send: (f) => frames.push(decodeFrame(f)),
    close: () => {
      closed = true;
    },
  };
  return {
    sub,
    frames,
    outputs: () => frames.filter((f): f is Extract<TermFrame, { type: "output" }> => f.type === "output").map((f) => [...f.data]),
    sizes: () => frames.filter((f): f is Extract<TermFrame, { type: "size" }> => f.type === "size"),
    isClosed: () => closed,
  };
}
const b = (...n: number[]) => new Uint8Array(n);

describe("PaneHub", () => {
  test("attach replays current size + ring buffer, then delivers live output", () => {
    const hub = new PaneHub();
    hub.setSize("p", 100, 40);
    hub.ingest("p", b(1, 2, 3));
    const s = makeSub();
    hub.attach("p", s.sub);
    // replay: a SIZE frame reflecting current size + the buffered output
    expect(s.sizes()[0]).toEqual({ type: "size", cols: 100, rows: 40 });
    expect(s.outputs()).toEqual([[1, 2, 3]]);
    // live
    hub.ingest("p", b(4, 5));
    expect(s.outputs()).toEqual([[1, 2, 3], [4, 5]]);
  });

  test("fans out to multiple independent subscribers", () => {
    const hub = new PaneHub();
    const a = makeSub();
    const c = makeSub();
    hub.attach("p", a.sub);
    hub.attach("p", c.sub);
    hub.ingest("p", b(7));
    expect(a.outputs()).toEqual([[7]]);
    expect(c.outputs()).toEqual([[7]]);
    expect(hub.subscriberCount("p")).toBe(2);
  });

  test("ring buffer is bounded — old output is evicted before replay", () => {
    const hub = new PaneHub({ ringMax: 4 });
    hub.ingest("p", b(1, 1)); // evicted
    hub.ingest("p", b(2, 2));
    hub.ingest("p", b(3, 3));
    const s = makeSub();
    hub.attach("p", s.sub);
    // only the most recent ~4 bytes survive
    expect(s.outputs().flat()).toEqual([2, 2, 3, 3]);
  });

  test("setSize notifies live subscribers", () => {
    const hub = new PaneHub();
    const s = makeSub();
    hub.attach("p", s.sub);
    hub.setSize("p", 120, 30);
    expect(s.sizes().at(-1)).toEqual({ type: "size", cols: 120, rows: 30 });
  });

  test("flow control: a non-acking subscriber is paused, then resyncs (reset + replay) on catch-up", () => {
    const hub = new PaneHub({ ringMax: 8, highWater: 12, lowWater: 4 });
    const s = makeSub();
    hub.attach("p", s.sub);
    for (let i = 1; i <= 5; i++) hub.ingest("p", b(i, i, i, i)); // 5×4B, no ACK
    // got the first 4 chunks (16B sent ≤ pending threshold), 5th skipped (now behind)
    expect(s.outputs()).toEqual([
      [1, 1, 1, 1],
      [2, 2, 2, 2],
      [3, 3, 3, 3],
      [4, 4, 4, 4],
    ]);
    const before = s.frames.length;
    hub.ingest("p", b(9, 9, 9, 9)); // still behind → dropped
    expect(s.frames.length).toBe(before);

    // ack enough to fall below lowWater → resync: RESET output + replayed ring + resume
    hub.ack("p", s.sub, 14);
    const resetSeen = s.outputs().some((o) => o[0] === 0x1b && o[1] === 0x63);
    expect(resetSeen).toBe(true);
    const afterResync = s.frames.length;
    hub.ingest("p", b(8)); // resumed → delivered
    expect(s.frames.length).toBeGreaterThan(afterResync);
    expect(s.outputs().at(-1)).toEqual([8]);
  });

  test("detach stops delivery", () => {
    const hub = new PaneHub();
    const s = makeSub();
    const detach = hub.attach("p", s.sub);
    hub.ingest("p", b(1));
    detach();
    hub.ingest("p", b(2));
    expect(s.outputs()).toEqual([[1]]);
    expect(hub.subscriberCount("p")).toBe(0);
  });

  test("closePane notifies + drops subscribers", () => {
    const hub = new PaneHub();
    const s = makeSub();
    hub.attach("p", s.sub);
    hub.closePane("p");
    expect(s.isClosed()).toBe(true);
    expect(hub.subscriberCount("p")).toBe(0);
  });
});
