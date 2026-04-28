import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { listSessions, type SavedSession } from "./session-store.js";
import type { ClaudeActivity } from "../adapters/types.js";

const COST_DIR = join(homedir(), ".agentmx");
const BUDGET_FILE = join(COST_DIR, "budgets.json");

export interface AgentBudget {
  agentName: string;
  /** Daily limit in USD */
  dailyLimit?: number;
  /** Weekly limit in USD */
  weeklyLimit?: number;
  /** Monthly limit in USD */
  monthlyLimit?: number;
  /** Total cumulative limit in USD */
  totalLimit?: number;
}

export interface BudgetConfig {
  /** Global daily limit across all agents */
  globalDailyLimit?: number;
  /** Global weekly limit across all agents */
  globalWeeklyLimit?: number;
  /** Global monthly limit across all agents */
  globalMonthlyLimit?: number;
  /** Per-agent budgets */
  agents: AgentBudget[];
}

export interface CostEntry {
  agentName: string;
  sessionId: string;
  cost: number;
  timestamp: number;
}

export interface BudgetAlert {
  level: "warning" | "exceeded";
  scope: string; // agent name or "global"
  period: string; // "daily" | "weekly" | "monthly" | "total"
  spent: number;
  limit: number;
  percentage: number;
}

export interface AgentCostSummary {
  agentName: string;
  todayCost: number;
  weekCost: number;
  monthCost: number;
  totalCost: number;
  sessionCount: number;
  avgCostPerSession: number;
  /** Sessions whose exit code was 0. */
  successCount: number;
  /** totalCost / successCount. Undefined when there are no successes. */
  costPerSuccess: number | undefined;
}

function ensureDir(): void {
  mkdirSync(COST_DIR, { recursive: true });
}

export function loadBudgetConfig(): BudgetConfig {
  ensureDir();
  try {
    const data = readFileSync(BUDGET_FILE, "utf-8");
    return JSON.parse(data) as BudgetConfig;
  } catch {
    return { agents: [] };
  }
}

export function saveBudgetConfig(config: BudgetConfig): void {
  ensureDir();
  writeFileSync(BUDGET_FILE, JSON.stringify(config, null, 2));
}

export function setBudget(
  agentName: string,
  limits: { daily?: number; weekly?: number; monthly?: number; total?: number }
): void {
  const config = loadBudgetConfig();
  const existing = config.agents.find((a) => a.agentName === agentName);

  if (existing) {
    if (limits.daily !== undefined) existing.dailyLimit = limits.daily;
    if (limits.weekly !== undefined) existing.weeklyLimit = limits.weekly;
    if (limits.monthly !== undefined) existing.monthlyLimit = limits.monthly;
    if (limits.total !== undefined) existing.totalLimit = limits.total;
  } else {
    config.agents.push({
      agentName,
      dailyLimit: limits.daily,
      weeklyLimit: limits.weekly,
      monthlyLimit: limits.monthly,
      totalLimit: limits.total,
    });
  }

  saveBudgetConfig(config);
}

export function setGlobalBudget(limits: {
  daily?: number;
  weekly?: number;
  monthly?: number;
}): void {
  const config = loadBudgetConfig();
  if (limits.daily !== undefined) config.globalDailyLimit = limits.daily;
  if (limits.weekly !== undefined) config.globalWeeklyLimit = limits.weekly;
  if (limits.monthly !== undefined) config.globalMonthlyLimit = limits.monthly;
  saveBudgetConfig(config);
}

function extractSessionCost(session: SavedSession): number {
  let cost = 0;
  for (const entry of session.buffer) {
    if (entry.activity?.kind === "cost") {
      const act = entry.activity as Extract<ClaudeActivity, { kind: "cost" }>;
      cost = Math.max(cost, act.totalCost);
    }
  }
  return cost;
}

function getTimeRanges(): { dayStart: number; weekStart: number; monthStart: number } {
  const now = new Date();

  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const weekDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
  const weekStart = weekDate.getTime();

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  return { dayStart, weekStart, monthStart };
}

export function getAgentCosts(): AgentCostSummary[] {
  const sessions = listSessions();
  const { dayStart, weekStart, monthStart } = getTimeRanges();

  const byAgent = new Map<string, SavedSession[]>();
  for (const s of sessions) {
    const arr = byAgent.get(s.agentName) ?? [];
    arr.push(s);
    byAgent.set(s.agentName, arr);
  }

  const summaries: AgentCostSummary[] = [];

  for (const [agentName, agentSessions] of byAgent) {
    let todayCost = 0;
    let weekCost = 0;
    let monthCost = 0;
    let totalCost = 0;
    let successCount = 0;

    for (const s of agentSessions) {
      const cost = extractSessionCost(s);
      totalCost += cost;
      if (s.endedAt >= monthStart) monthCost += cost;
      if (s.endedAt >= weekStart) weekCost += cost;
      if (s.endedAt >= dayStart) todayCost += cost;
      if (s.status === "done") successCount += 1;
    }

    summaries.push({
      agentName,
      todayCost,
      weekCost,
      monthCost,
      totalCost,
      sessionCount: agentSessions.length,
      avgCostPerSession: agentSessions.length > 0 ? totalCost / agentSessions.length : 0,
      successCount,
      costPerSuccess: successCount > 0 ? totalCost / successCount : undefined,
    });
  }

  summaries.sort((a, b) => b.totalCost - a.totalCost);
  return summaries;
}

export function checkBudgets(): BudgetAlert[] {
  const config = loadBudgetConfig();
  const costs = getAgentCosts();
  const alerts: BudgetAlert[] = [];
  const WARNING_THRESHOLD = 80; // 80% = warning

  // Check per-agent budgets
  for (const budget of config.agents) {
    const agentCost = costs.find((c) => c.agentName === budget.agentName);
    if (!agentCost) continue;

    const checks: Array<{ period: string; spent: number; limit?: number }> = [
      { period: "daily", spent: agentCost.todayCost, limit: budget.dailyLimit },
      { period: "weekly", spent: agentCost.weekCost, limit: budget.weeklyLimit },
      { period: "monthly", spent: agentCost.monthCost, limit: budget.monthlyLimit },
      { period: "total", spent: agentCost.totalCost, limit: budget.totalLimit },
    ];

    for (const check of checks) {
      if (check.limit === undefined || check.limit <= 0) continue;
      const pct = (check.spent / check.limit) * 100;
      if (pct >= 100) {
        alerts.push({
          level: "exceeded",
          scope: budget.agentName,
          period: check.period,
          spent: check.spent,
          limit: check.limit,
          percentage: pct,
        });
      } else if (pct >= WARNING_THRESHOLD) {
        alerts.push({
          level: "warning",
          scope: budget.agentName,
          period: check.period,
          spent: check.spent,
          limit: check.limit,
          percentage: pct,
        });
      }
    }
  }

  // Check global budgets
  const globalToday = costs.reduce((sum, c) => sum + c.todayCost, 0);
  const globalWeek = costs.reduce((sum, c) => sum + c.weekCost, 0);
  const globalMonth = costs.reduce((sum, c) => sum + c.monthCost, 0);

  const globalChecks: Array<{ period: string; spent: number; limit?: number }> = [
    { period: "daily", spent: globalToday, limit: config.globalDailyLimit },
    { period: "weekly", spent: globalWeek, limit: config.globalWeeklyLimit },
    { period: "monthly", spent: globalMonth, limit: config.globalMonthlyLimit },
  ];

  for (const check of globalChecks) {
    if (check.limit === undefined || check.limit <= 0) continue;
    const pct = (check.spent / check.limit) * 100;
    if (pct >= 100) {
      alerts.push({
        level: "exceeded",
        scope: "global",
        period: check.period,
        spent: check.spent,
        limit: check.limit,
        percentage: pct,
      });
    } else if (pct >= WARNING_THRESHOLD) {
      alerts.push({
        level: "warning",
        scope: "global",
        period: check.period,
        spent: check.spent,
        limit: check.limit,
        percentage: pct,
      });
    }
  }

  return alerts;
}
