import { describe, expect, test } from "bun:test";
import { computeSessionCost, type PriceTable } from "../src/cost";
import type { SessionMessage } from "../src/types";

const PRICES: PriceTable = {
  opus: { inputPerM: 10, outputPerM: 40, cacheReadPerM: 1, cacheWritePerM: 12 },
  haiku: { inputPerM: 1, outputPerM: 4 },
};

function asst(model: string | undefined, usage: SessionMessage["usage"]): SessionMessage {
  return { id: "m", role: "assistant", model, blocks: [], usage };
}

describe("computeSessionCost", () => {
  test("sums tokens and computes USD from the price table", () => {
    const cost = computeSessionCost(
      [
        asst("claude-opus-4-8", { inputTokens: 1_000_000, outputTokens: 1_000_000 }),
        asst("claude-opus-4-8", { inputTokens: 0, outputTokens: 500_000, cacheReadTokens: 2_000_000 }),
      ],
      PRICES,
    );
    expect(cost.inputTokens).toBe(1_000_000);
    expect(cost.outputTokens).toBe(1_500_000);
    expect(cost.cacheReadTokens).toBe(2_000_000);
    // 1M in*10 + 1.5M out*40 + 2M cacheRead*1 = 10 + 60 + 2 = 72
    expect(cost.usd).toBeCloseTo(72, 6);
    expect(cost.totalTokens).toBe(4_500_000);
  });

  test("matches model family by substring", () => {
    const cost = computeSessionCost([asst("claude-haiku-4-5", { inputTokens: 2_000_000, outputTokens: 1_000_000 })], PRICES);
    // 2M*1 + 1M*4 = 2 + 4 = 6
    expect(cost.usd).toBeCloseTo(6, 6);
  });

  test("counts unpriced tokens when no model price matches", () => {
    const cost = computeSessionCost([asst("some-unknown-model", { inputTokens: 1000, outputTokens: 500 })], PRICES);
    expect(cost.usd).toBe(0);
    expect(cost.unpricedTokens).toBe(1500);
    expect(cost.totalTokens).toBe(1500);
  });

  test("ignores messages without usage", () => {
    const cost = computeSessionCost([{ id: "x", role: "user", blocks: [] }], PRICES);
    expect(cost.totalTokens).toBe(0);
    expect(cost.usd).toBe(0);
  });
});
