import { describe, expect, test } from "bun:test";
import { ApprovalQueue } from "../src/approvalQueue";

describe("ApprovalQueue", () => {
  test("auto-allows read-only tools without enqueuing", async () => {
    const q = new ApprovalQueue();
    const r = await q.submit({ sessionId: "s1", tool: "Read", input: { file_path: "/x" } });
    expect(r.decision).toBe("allow");
    expect(q.list()).toEqual([]);
  });

  test("auto-denies catastrophic commands without enqueuing", async () => {
    const q = new ApprovalQueue();
    const r = await q.submit({ sessionId: "s1", tool: "Bash", input: { command: "rm -rf /" } });
    expect(r.decision).toBe("deny");
    expect(q.list()).toEqual([]);
  });

  test("enqueues an 'ask' and resolves it when the user decides", async () => {
    const q = new ApprovalQueue();
    let enqueued: any;
    const p = q.submit(
      { sessionId: "s1", tool: "Bash", input: { command: "git push" } },
      { onEnqueue: (req) => (enqueued = req) },
    );
    // pending until resolved
    expect(q.list()).toHaveLength(1);
    expect(enqueued.dangerous).toBe(true);
    expect(enqueued.tool).toBe("Bash");

    q.resolve(enqueued.id, "allow");
    const r = await p;
    expect(r.decision).toBe("allow");
    expect(q.list()).toEqual([]); // dequeued
  });

  test("an unanswered 'ask' fails closed (deny) after the timeout", async () => {
    const q = new ApprovalQueue();
    const r = await q.submit(
      { sessionId: "s1", tool: "Bash", input: { command: "curl http://x" } },
      { timeoutMs: 15 },
    );
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/timed out/);
    expect(q.list()).toEqual([]);
  });

  test("resolve returns false for an unknown id", () => {
    const q = new ApprovalQueue();
    expect(q.resolve("nope", "allow")).toBe(false);
  });

  test("clear denies everything outstanding", async () => {
    const q = new ApprovalQueue();
    const p = q.submit({ sessionId: "s1", tool: "Bash", input: { command: "git push" } }, { timeoutMs: 10_000 });
    expect(q.list()).toHaveLength(1);
    q.clear();
    const r = await p;
    expect(r.decision).toBe("deny");
    expect(q.list()).toEqual([]);
  });
});
