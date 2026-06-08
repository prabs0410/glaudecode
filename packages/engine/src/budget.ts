// Budgets + cost rollups (Epic C §3.3). Interactive Claude Code sessions cost real money
// (the SDK credit pool); to leave agents running you need a per-project cap that warns
// before you blow past it. The pure functions (aggregate, evaluate) are unit-tested; the
// CostStore persists append-only daily rollups + the budget config under ~/.glaudecode.
// Cost data is local only (§6). The rule-based meta-agent (Epic B) is $0 so it trivially
// respects any cap; the same evaluateBudget gates future SDK-query spend.

export interface DayCost {
  date: string; // YYYY-MM-DD
  usd: number;
  tokens: number;
}

export interface Budget {
  dailyUsd?: number;
  totalUsd?: number;
  /** Fraction (0–1) at which state becomes "warn". Default 0.8. */
  warnPct: number;
}

export interface RollupSummary {
  byDate: Record<string, DayCost>;
  totalUsd: number;
  totalTokens: number;
}

export type BudgetState = "none" | "ok" | "warn" | "over";

export interface BudgetStatus {
  state: BudgetState;
  dailyUsd: number;
  totalUsd: number;
  /** Fraction of the daily cap used, if a daily cap is set. */
  dailyPct?: number;
  /** Fraction of the total cap used, if a total cap is set. */
  totalPct?: number;
  budget?: Budget;
}

/** Parse append-only JSONL rollup lines, tolerating bad lines (§5), and aggregate. */
export function aggregateDayCosts(lines: string[]): RollupSummary {
  const byDate: Record<string, DayCost> = {};
  let totalUsd = 0;
  let totalTokens = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: DayCost;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue; // skip a corrupt line rather than fail the whole rollup
    }
    if (!entry || typeof entry.date !== "string") continue;
    const usd = Number(entry.usd) || 0;
    const tokens = Number(entry.tokens) || 0;
    const cur = byDate[entry.date] ?? { date: entry.date, usd: 0, tokens: 0 };
    cur.usd += usd;
    cur.tokens += tokens;
    byDate[entry.date] = cur;
    totalUsd += usd;
    totalTokens += tokens;
  }
  return { byDate, totalUsd, totalTokens };
}

/** Evaluate spend against a budget → ok/warn/over (or "none" when no budget is set). */
export function evaluateBudget(
  budget: Budget | undefined,
  spend: { dailyUsd: number; totalUsd: number },
): BudgetStatus {
  const base: BudgetStatus = { state: "none", dailyUsd: spend.dailyUsd, totalUsd: spend.totalUsd };
  if (!budget || (budget.dailyUsd === undefined && budget.totalUsd === undefined)) return base;

  const pcts: number[] = [];
  if (budget.dailyUsd && budget.dailyUsd > 0) {
    base.dailyPct = spend.dailyUsd / budget.dailyUsd;
    pcts.push(base.dailyPct);
  }
  if (budget.totalUsd && budget.totalUsd > 0) {
    base.totalPct = spend.totalUsd / budget.totalUsd;
    pcts.push(base.totalPct);
  }
  base.budget = budget;
  const worst = pcts.length ? Math.max(...pcts) : 0;
  base.state = worst >= 1 ? "over" : worst >= budget.warnPct ? "warn" : "ok";
  return base;
}

// ---------- persistence ----------

import { homedir } from "node:os";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";

interface BudgetFile {
  [projectDir: string]: Budget;
}

export class CostStore {
  constructor(private readonly home: string = homedir()) {}

  private rollupPath(projectDir: string): string {
    return join(this.home, ".glaudecode", "cost", `${sanitize(projectDir)}.jsonl`);
  }
  private budgetsPath(): string {
    return join(this.home, ".glaudecode", "budgets.json");
  }

  /** Append a daily cost snapshot (append-only; aggregation merges same-date lines). */
  async recordDailyCost(projectDir: string, entry: DayCost): Promise<void> {
    const path = this.rollupPath(projectDir);
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, JSON.stringify(entry) + "\n", "utf8");
  }

  async readRollup(projectDir: string): Promise<RollupSummary> {
    try {
      const raw = await readFile(this.rollupPath(projectDir), "utf8");
      return aggregateDayCosts(raw.split("\n"));
    } catch (e: any) {
      if (e?.code === "ENOENT") return { byDate: {}, totalUsd: 0, totalTokens: 0 };
      throw e;
    }
  }

  async getBudget(projectDir: string): Promise<Budget | undefined> {
    return (await this.readBudgets())[projectDir];
  }

  async setBudget(projectDir: string, budget: Budget): Promise<void> {
    const all = await this.readBudgets();
    all[projectDir] = budget;
    const path = this.budgetsPath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(all, null, 2) + "\n", "utf8");
  }

  private async readBudgets(): Promise<BudgetFile> {
    try {
      const raw = await readFile(this.budgetsPath(), "utf8");
      return raw.trim() ? (JSON.parse(raw) as BudgetFile) : {};
    } catch (e: any) {
      if (e?.code === "ENOENT") return {};
      throw e;
    }
  }
}

function sanitize(dir: string): string {
  return dir.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "root";
}
