import { describe, expect, test } from "bun:test";
import { RateLimiter } from "../src/rateLimiter";

describe("RateLimiter", () => {
  test("allows up to max, then denies within the window", () => {
    let t = 0;
    const rl = new RateLimiter(() => t, [{ windowMs: 60_000, max: 2 }]);
    expect(rl.hit("ip")).toBe(true); // 1
    expect(rl.hit("ip")).toBe(true); // 2
    expect(rl.hit("ip")).toBe(false); // 3 — over
    expect(rl.hit("ip")).toBe(false); // still over
  });

  test("denied attempts do not extend the lockout — recovers as the window slides", () => {
    let t = 0;
    const rl = new RateLimiter(() => t, [{ windowMs: 60_000, max: 2 }]);
    rl.hit("ip"); // t=0
    t = 1_000;
    rl.hit("ip"); // t=1s (2 in window)
    t = 30_000;
    expect(rl.hit("ip")).toBe(false); // denied (2 in last 60s); not recorded
    t = 61_000; // first attempt (t=0) has slid out; only t=1s remains (1 in window)
    expect(rl.hit("ip")).toBe(true);
  });

  test("keys are independent", () => {
    let t = 0;
    const rl = new RateLimiter(() => t, [{ windowMs: 60_000, max: 1 }]);
    expect(rl.hit("a")).toBe(true);
    expect(rl.hit("a")).toBe(false);
    expect(rl.hit("b")).toBe(true); // different key unaffected
  });

  test("composes multiple windows (e.g. 2/min AND 12/hr)", () => {
    let t = 0;
    const rl = new RateLimiter(() => t, [
      { windowMs: 60_000, max: 2 },
      { windowMs: 3_600_000, max: 3 },
    ]);
    expect(rl.hit("ip")).toBe(true); // 1
    expect(rl.hit("ip")).toBe(true); // 2
    t = 120_000; // minute window cleared
    expect(rl.hit("ip")).toBe(true); // 3 (within hour limit)
    t = 180_000;
    expect(rl.hit("ip")).toBe(false); // hour cap (3) hit
  });

  test("reset clears a key's history", () => {
    let t = 0;
    const rl = new RateLimiter(() => t, [{ windowMs: 60_000, max: 1 }]);
    expect(rl.hit("ip")).toBe(true);
    expect(rl.hit("ip")).toBe(false);
    rl.reset("ip");
    expect(rl.hit("ip")).toBe(true);
  });
});
