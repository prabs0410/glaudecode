import { describe, expect, test } from "bun:test";
import { EventBus, type LifecycleEvent } from "../src/eventBus";

const ev = (over: Partial<LifecycleEvent> = {}): LifecycleEvent => ({
  type: "session_start",
  sessionId: "s1",
  ...over,
});

describe("EventBus", () => {
  test("delivers to type-specific subscribers", () => {
    const bus = new EventBus();
    const seen: LifecycleEvent[] = [];
    bus.on("session_start", (e) => seen.push(e));
    const res = bus.emit(ev({ reason: "new" }));
    expect(res.delivered).toBe(1);
    expect(seen).toEqual([ev({ reason: "new" })]);
  });

  test("does not deliver to other types", () => {
    const bus = new EventBus();
    let calls = 0;
    bus.on("session_shutdown", () => calls++);
    bus.emit(ev({ type: "session_start" }));
    expect(calls).toBe(0);
  });

  test("wildcard receives every event", () => {
    const bus = new EventBus();
    const types: string[] = [];
    bus.on("*", (e) => types.push(e.type));
    bus.emit(ev({ type: "session_start" }));
    bus.emit(ev({ type: "session_shutdown" }));
    expect(types).toEqual(["session_start", "session_shutdown"]);
  });

  test("type + wildcard both fire for a matching event", () => {
    const bus = new EventBus();
    let typed = 0;
    let wild = 0;
    bus.on("session_compact", () => typed++);
    bus.on("*", () => wild++);
    const res = bus.emit(ev({ type: "session_compact" }));
    expect(typed).toBe(1);
    expect(wild).toBe(1);
    expect(res.delivered).toBe(2);
  });

  test("unsubscribe via returned disposer stops delivery", () => {
    const bus = new EventBus();
    let calls = 0;
    const off = bus.on("session_start", () => calls++);
    bus.emit(ev());
    off();
    bus.emit(ev());
    expect(calls).toBe(1);
    expect(bus.listenerCount("session_start")).toBe(0);
  });

  test("a throwing handler is isolated; others still receive the event", () => {
    const bus = new EventBus();
    const boom = () => {
      throw new Error("bad handler");
    };
    let goodCalls = 0;
    bus.on("session_start", boom);
    bus.on("session_start", () => goodCalls++);
    const res = bus.emit(ev());
    expect(goodCalls).toBe(1);
    expect(res.delivered).toBe(2);
    expect(res.errors).toHaveLength(1);
    expect((res.errors[0].error as Error).message).toBe("bad handler");
  });

  test("listenerCount totals across types; clear removes all", () => {
    const bus = new EventBus();
    bus.on("session_start", () => {});
    bus.on("session_shutdown", () => {});
    bus.on("*", () => {});
    expect(bus.listenerCount()).toBe(3);
    bus.clear();
    expect(bus.listenerCount()).toBe(0);
  });
});
