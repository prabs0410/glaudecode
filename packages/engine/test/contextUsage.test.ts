import { describe, expect, test } from "bun:test";
import { computeContextUsage } from "../src/contextUsage";
import type { SessionMessage } from "../src/types";

const asst = (model: string, usage: SessionMessage["usage"]): SessionMessage => ({
  id: Math.random().toString(36).slice(2),
  role: "assistant",
  model,
  blocks: [],
  usage,
});

describe("computeContextUsage", () => {
  test("sums input-side tokens of the latest assistant turn over the model limit", () => {
    const out = computeContextUsage([
      asst("claude-opus-4-8", { inputTokens: 100_000, cacheReadTokens: 50_000, cacheCreationTokens: 10_000 }),
    ]);
    expect(out).not.toBeNull();
    expect(out!.usedTokens).toBe(160_000);
    expect(out!.limit).toBe(1_000_000);
    expect(out!.pct).toBeCloseTo(0.16, 5);
    expect(out!.nearCompaction).toBe(false);
    expect(out!.model).toBe("claude-opus-4-8");
  });

  test("uses the most recent assistant message with usage", () => {
    const out = computeContextUsage([
      asst("claude-opus-4-8", { inputTokens: 10 }),
      asst("claude-opus-4-8", { inputTokens: 900_000 }),
    ]);
    expect(out!.usedTokens).toBe(900_000);
    expect(out!.pct).toBeCloseTo(0.9, 5);
  });

  test("flags nearCompaction past the warn threshold", () => {
    const out = computeContextUsage([asst("claude-haiku-4-5", { inputTokens: 180_000 })]);
    expect(out!.limit).toBe(200_000);
    expect(out!.pct).toBeCloseTo(0.9, 5);
    expect(out!.nearCompaction).toBe(true);
  });

  test("custom warnPct is honored", () => {
    const out = computeContextUsage([asst("claude-opus-4-8", { inputTokens: 700_000 })], { warnPct: 0.6 });
    expect(out!.nearCompaction).toBe(true);
  });

  test("pct clamps to 1 when usage exceeds the limit", () => {
    const out = computeContextUsage([asst("claude-haiku-4-5", { inputTokens: 250_000 })]);
    expect(out!.pct).toBe(1);
  });

  test("returns null when the model limit is unknown (hide the gauge)", () => {
    expect(computeContextUsage([asst("some-future-model", { inputTokens: 1000 })])).toBeNull();
  });

  test("returns null when there is no assistant usage", () => {
    expect(computeContextUsage([{ id: "u", role: "user", blocks: [] }])).toBeNull();
    expect(computeContextUsage([])).toBeNull();
  });

  test("model override wins over the message model", () => {
    const out = computeContextUsage([asst("some-future-model", { inputTokens: 100_000 })], {
      model: "claude-opus-4-8",
    });
    expect(out!.limit).toBe(1_000_000);
  });
});
