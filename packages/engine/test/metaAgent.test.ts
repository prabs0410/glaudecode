import { describe, expect, test } from "bun:test";
import { MetaAgent, generateObservations, type MetaAgentInput } from "../src/metaAgent";
import type { AgentState } from "../src/agentState";
import type { ChangeEntry } from "../src/changes";

const NOW = 1_700_000_000_000;
const ch = (path: string): ChangeEntry => ({ path, edits: 1, lastTool: "Edit" });
const input = (
  sessionId: string,
  state: AgentState,
  changes: ChangeEntry[] = [],
  title?: string,
): MetaAgentInput => ({ sessionId, title, state, changes });

describe("generateObservations", () => {
  test("flags a session stuck running a tool past the threshold", () => {
    const obs = generateObservations(
      [input("s1", { status: "running-tool", toolName: "Bash", sinceMs: NOW - 6 * 60_000 }, [], "build")],
      { now: NOW },
    );
    expect(obs).toHaveLength(1);
    expect(obs[0]).toMatchObject({ id: "stuck:s1", level: "warn", sessionIds: ["s1"] });
    expect(obs[0].text).toContain("build");
    expect(obs[0].text).toContain("running Bash");
  });

  test("does not flag a session working under the threshold", () => {
    const obs = generateObservations(
      [input("s1", { status: "thinking", sinceMs: NOW - 60_000 })],
      { now: NOW },
    );
    expect(obs).toEqual([]);
  });

  test("flags a cross-session file conflict (reuses ConflictDetector)", () => {
    const obs = generateObservations(
      [
        input("s1", { status: "running-tool", sinceMs: NOW }, [ch("/a/x.ts")], "alpha"),
        input("s2", { status: "running-tool", sinceMs: NOW }, [ch("/a/x.ts")], "beta"),
      ],
      { now: NOW },
    );
    const conflict = obs.find((o) => o.id === "conflict:/a/x.ts");
    expect(conflict).toBeDefined();
    expect(conflict!.level).toBe("warn");
    expect(conflict!.sessionIds.sort()).toEqual(["s1", "s2"]);
    expect(conflict!.text).toContain("x.ts");
    expect(conflict!.text).toContain("alpha");
    expect(conflict!.text).toContain("beta");
  });

  test("flags an idle session that changed files as finished", () => {
    const obs = generateObservations(
      [input("s1", { status: "idle" }, [ch("/a.ts"), ch("/b.ts")], "work")],
      { now: NOW },
    );
    expect(obs).toEqual([
      {
        id: "finished:s1",
        level: "info",
        text: "work is idle after changing 2 files",
        sessionIds: ["s1"],
        at: new Date(NOW).toISOString(),
      },
    ]);
  });

  test("idle with no changes produces nothing", () => {
    expect(generateObservations([input("s1", { status: "idle" })], { now: NOW })).toEqual([]);
  });

  test("ids are deterministic across runs (dedupe-friendly)", () => {
    const a = generateObservations([input("s1", { status: "idle" }, [ch("/a.ts")])], { now: NOW });
    const b = generateObservations([input("s1", { status: "idle" }, [ch("/a.ts")])], { now: NOW + 5000 });
    expect(a[0].id).toBe(b[0].id);
  });
});

describe("MetaAgent", () => {
  test("is off by default and returns nothing", () => {
    const ma = new MetaAgent();
    expect(ma.isEnabled()).toBe(false);
    const obs = ma.observe([input("s1", { status: "idle" }, [ch("/a.ts")])], { now: NOW });
    expect(obs).toEqual([]);
  });

  test("emits observations once enabled; cost is 0 (rule-based)", () => {
    const ma = new MetaAgent();
    ma.setEnabled(true);
    expect(ma.estimatedCostUsd()).toBe(0);
    const obs = ma.observe([input("s1", { status: "idle" }, [ch("/a.ts")])], { now: NOW });
    expect(obs).toHaveLength(1);
    expect(obs[0].id).toBe("finished:s1");
  });
});
