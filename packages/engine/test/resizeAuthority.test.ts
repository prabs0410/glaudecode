import { describe, expect, test } from "bun:test";
import { DesktopPresence, mayResize, DESKTOP_PRESENCE_GRACE_MS } from "../src/resizeAuthority";

describe("resize authority (V6 Phase 1.7)", () => {
  test("mayResize is false within the grace, true after", () => {
    expect(mayResize(1000, 1000 + DESKTOP_PRESENCE_GRACE_MS - 1)).toBe(false);
    expect(mayResize(1000, 1000 + DESKTOP_PRESENCE_GRACE_MS)).toBe(true);
  });

  test("a desktop viewer is assumed present at startup (fail-safe: phone can't reshape immediately)", () => {
    let now = 10_000;
    const dp = new DesktopPresence(() => now, 30_000);
    expect(dp.phoneMayResize()).toBe(false); // just launched — desk assumed present
  });

  test("the phone may resize only after the desktop goes quiet for the grace window", () => {
    let now = 10_000;
    const dp = new DesktopPresence(() => now, 30_000);
    now = 39_999; // 29.999s since startup — still within grace
    expect(dp.phoneMayResize()).toBe(false);
    now = 40_000; // 30s of quiet
    expect(dp.phoneMayResize()).toBe(true);
  });

  test("a desktop heartbeat re-asserts presence and blocks the phone again", () => {
    let now = 0;
    const dp = new DesktopPresence(() => now, 30_000);
    now = 40_000;
    expect(dp.phoneMayResize()).toBe(true); // desk quiet → phone may take size
    dp.heartbeat(); // the user came back to the desk (window focused)
    expect(dp.phoneMayResize()).toBe(false); // protected again
    now = 70_001;
    expect(dp.phoneMayResize()).toBe(true); // quiet again past the grace
  });
});
