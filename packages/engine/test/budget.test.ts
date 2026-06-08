import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CostStore, aggregateDayCosts, evaluateBudget, type Budget } from "../src/budget";

describe("aggregateDayCosts", () => {
  test("merges same-date entries and totals", () => {
    const out = aggregateDayCosts([
      JSON.stringify({ date: "2026-06-09", usd: 1.5, tokens: 100 }),
      JSON.stringify({ date: "2026-06-09", usd: 0.5, tokens: 50 }),
      JSON.stringify({ date: "2026-06-08", usd: 2, tokens: 200 }),
    ]);
    expect(out.byDate["2026-06-09"]).toEqual({ date: "2026-06-09", usd: 2, tokens: 150 });
    expect(out.totalUsd).toBe(4);
    expect(out.totalTokens).toBe(350);
  });

  test("skips blank and corrupt lines (tolerant)", () => {
    const out = aggregateDayCosts([
      JSON.stringify({ date: "2026-06-09", usd: 1, tokens: 10 }),
      "",
      "{ not json",
      JSON.stringify({ usd: 5 }), // no date → skipped
    ]);
    expect(out.totalUsd).toBe(1);
  });
});

describe("evaluateBudget", () => {
  const warn: Budget = { dailyUsd: 10, warnPct: 0.8 };

  test("returns 'none' with no budget", () => {
    expect(evaluateBudget(undefined, { dailyUsd: 5, totalUsd: 5 }).state).toBe("none");
  });

  test("ok below the warn threshold", () => {
    const s = evaluateBudget(warn, { dailyUsd: 5, totalUsd: 5 });
    expect(s.state).toBe("ok");
    expect(s.dailyPct).toBeCloseTo(0.5, 5);
  });

  test("warn at/above the threshold", () => {
    expect(evaluateBudget(warn, { dailyUsd: 8, totalUsd: 8 }).state).toBe("warn");
  });

  test("over at/above the cap", () => {
    expect(evaluateBudget(warn, { dailyUsd: 10, totalUsd: 10 }).state).toBe("over");
    expect(evaluateBudget(warn, { dailyUsd: 12, totalUsd: 12 }).state).toBe("over");
  });

  test("uses the worst of daily and total caps", () => {
    const b: Budget = { dailyUsd: 100, totalUsd: 10, warnPct: 0.8 };
    // daily 5% but total 90% → warn
    expect(evaluateBudget(b, { dailyUsd: 5, totalUsd: 9 }).state).toBe("warn");
  });
});

const tmpDirs: string[] = [];
afterAll(async () => {
  for (const d of tmpDirs) await rm(d, { recursive: true, force: true });
});

describe("CostStore (fs)", () => {
  test("records + aggregates daily cost and round-trips a budget", async () => {
    const home = await mkdtemp(join(tmpdir(), "glaude-cost-"));
    tmpDirs.push(home);
    const store = new CostStore(home);
    const project = "/Users/me/repo";

    expect(await store.readRollup(project)).toEqual({ byDate: {}, totalUsd: 0, totalTokens: 0 });

    await store.recordDailyCost(project, { date: "2026-06-09", usd: 1.25, tokens: 100 });
    await store.recordDailyCost(project, { date: "2026-06-09", usd: 0.75, tokens: 50 });
    const rollup = await store.readRollup(project);
    expect(rollup.totalUsd).toBe(2);
    expect(rollup.byDate["2026-06-09"].tokens).toBe(150);

    expect(await store.getBudget(project)).toBeUndefined();
    await store.setBudget(project, { dailyUsd: 5, warnPct: 0.8 });
    expect(await store.getBudget(project)).toEqual({ dailyUsd: 5, warnPct: 0.8 });
  });
});
