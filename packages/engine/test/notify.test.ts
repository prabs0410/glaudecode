import { describe, expect, test } from "bun:test";
import { coalesceNotifications, type AppNotification } from "../src/notify";

const n = (kind: AppNotification["kind"], text = "x", sessionId?: string): AppNotification => ({ kind, text, sessionId });

describe("coalesceNotifications", () => {
  test("passes a single notification through unchanged", () => {
    const items = [n("approval", "Bash needs approval", "s1")];
    expect(coalesceNotifications(items)).toEqual(items);
  });

  test("coalesces several of the same kind into one summary", () => {
    const out = coalesceNotifications([n("finished"), n("finished"), n("finished")]);
    expect(out).toEqual([{ kind: "finished", text: "3 sessions finished" }]);
  });

  test("keeps different kinds separate", () => {
    const out = coalesceNotifications([n("finished"), n("finished"), n("approval", "approve me", "s2")]);
    expect(out).toHaveLength(2);
    expect(out.find((o) => o.kind === "finished")?.text).toBe("2 sessions finished");
    expect(out.find((o) => o.kind === "approval")?.text).toBe("approve me");
  });

  test("empty in, empty out", () => {
    expect(coalesceNotifications([])).toEqual([]);
  });
});
