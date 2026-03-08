import { listSessions, type SavedSession } from "./session-store.js";
import type { ClaudeActivity } from "../adapters/types.js";

export interface AgentStats {
  agentName: string;
  totalTasks: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  avgDurationMs: number;
  totalDurationMs: number;
  totalCost: number;
  avgCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export interface DailyStats {
  date: string; // YYYY-MM-DD
  taskCount: number;
  successCount: number;
  errorCount: number;
  totalCost: number;
  totalDurationMs: number;
  agentBreakdown: Record<string, number>;
}

export interface WeeklyStats {
  weekStart: string; // YYYY-MM-DD (Monday)
  weekEnd: string;
  taskCount: number;
  successCount: number;
  errorCount: number;
  totalCost: number;
  totalDurationMs: number;
  agentBreakdown: Record<string, number>;
}

export interface AnalyticsSummary {
  totalSessions: number;
  totalCost: number;
  totalDurationMs: number;
  overallSuccessRate: number;
  agentStats: AgentStats[];
  dailyStats: DailyStats[];
  weeklyStats: WeeklyStats[];
}

function extractCostFromSession(session: SavedSession): {
  cost: number;
  inputTokens: number;
  outputTokens: number;
} {
  let cost = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const entry of session.buffer) {
    if (entry.activity?.kind === "cost") {
      const act = entry.activity as Extract<ClaudeActivity, { kind: "cost" }>;
      cost = Math.max(cost, act.totalCost);
      if (act.usage) {
        inputTokens += (act.usage.input_tokens as number) ?? 0;
        outputTokens += (act.usage.output_tokens as number) ?? 0;
      }
    }
  }

  return { cost, inputTokens, outputTokens };
}

function toDateString(ts: number): string {
  const d = new Date(ts);
  return d.toISOString().split("T")[0];
}

function getWeekStart(ts: number): string {
  const d = new Date(ts);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  const monday = new Date(d);
  monday.setDate(diff);
  return monday.toISOString().split("T")[0];
}

function getWeekEnd(weekStart: string): string {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 6);
  return d.toISOString().split("T")[0];
}

export function computeAgentStats(sessions: SavedSession[]): AgentStats[] {
  const byAgent = new Map<string, SavedSession[]>();

  for (const s of sessions) {
    const arr = byAgent.get(s.agentName) ?? [];
    arr.push(s);
    byAgent.set(s.agentName, arr);
  }

  const stats: AgentStats[] = [];

  for (const [agentName, agentSessions] of byAgent) {
    const successCount = agentSessions.filter((s) => s.status === "done").length;
    const errorCount = agentSessions.filter((s) => s.status === "error").length;
    const totalTasks = agentSessions.length;

    let totalDurationMs = 0;
    let totalCost = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const s of agentSessions) {
      totalDurationMs += s.endedAt - s.startedAt;
      const costInfo = extractCostFromSession(s);
      totalCost += costInfo.cost;
      totalInputTokens += costInfo.inputTokens;
      totalOutputTokens += costInfo.outputTokens;
    }

    stats.push({
      agentName,
      totalTasks,
      successCount,
      errorCount,
      successRate: totalTasks > 0 ? (successCount / totalTasks) * 100 : 0,
      avgDurationMs: totalTasks > 0 ? totalDurationMs / totalTasks : 0,
      totalDurationMs,
      totalCost,
      avgCost: totalTasks > 0 ? totalCost / totalTasks : 0,
      totalInputTokens,
      totalOutputTokens,
    });
  }

  stats.sort((a, b) => b.totalTasks - a.totalTasks);
  return stats;
}

export function computeDailyStats(sessions: SavedSession[]): DailyStats[] {
  const byDay = new Map<string, SavedSession[]>();

  for (const s of sessions) {
    const date = toDateString(s.endedAt);
    const arr = byDay.get(date) ?? [];
    arr.push(s);
    byDay.set(date, arr);
  }

  const stats: DailyStats[] = [];

  for (const [date, daySessions] of byDay) {
    const agentBreakdown: Record<string, number> = {};
    let totalCost = 0;
    let totalDurationMs = 0;

    for (const s of daySessions) {
      agentBreakdown[s.agentName] = (agentBreakdown[s.agentName] ?? 0) + 1;
      totalCost += extractCostFromSession(s).cost;
      totalDurationMs += s.endedAt - s.startedAt;
    }

    stats.push({
      date,
      taskCount: daySessions.length,
      successCount: daySessions.filter((s) => s.status === "done").length,
      errorCount: daySessions.filter((s) => s.status === "error").length,
      totalCost,
      totalDurationMs,
      agentBreakdown,
    });
  }

  stats.sort((a, b) => a.date.localeCompare(b.date));
  return stats;
}

export function computeWeeklyStats(sessions: SavedSession[]): WeeklyStats[] {
  const byWeek = new Map<string, SavedSession[]>();

  for (const s of sessions) {
    const weekStart = getWeekStart(s.endedAt);
    const arr = byWeek.get(weekStart) ?? [];
    arr.push(s);
    byWeek.set(weekStart, arr);
  }

  const stats: WeeklyStats[] = [];

  for (const [weekStart, weekSessions] of byWeek) {
    const agentBreakdown: Record<string, number> = {};
    let totalCost = 0;
    let totalDurationMs = 0;

    for (const s of weekSessions) {
      agentBreakdown[s.agentName] = (agentBreakdown[s.agentName] ?? 0) + 1;
      totalCost += extractCostFromSession(s).cost;
      totalDurationMs += s.endedAt - s.startedAt;
    }

    stats.push({
      weekStart,
      weekEnd: getWeekEnd(weekStart),
      taskCount: weekSessions.length,
      successCount: weekSessions.filter((s) => s.status === "done").length,
      errorCount: weekSessions.filter((s) => s.status === "error").length,
      totalCost,
      totalDurationMs,
      agentBreakdown,
    });
  }

  stats.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  return stats;
}

export function getAnalyticsSummary(days?: number): AnalyticsSummary {
  let sessions = listSessions();

  if (days) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    sessions = sessions.filter((s) => s.endedAt >= cutoff);
  }

  const agentStats = computeAgentStats(sessions);
  const dailyStats = computeDailyStats(sessions);
  const weeklyStats = computeWeeklyStats(sessions);

  const totalCost = agentStats.reduce((sum, a) => sum + a.totalCost, 0);
  const totalDurationMs = agentStats.reduce((sum, a) => sum + a.totalDurationMs, 0);
  const totalSessions = sessions.length;
  const successCount = sessions.filter((s) => s.status === "done").length;

  return {
    totalSessions,
    totalCost,
    totalDurationMs,
    overallSuccessRate: totalSessions > 0 ? (successCount / totalSessions) * 100 : 0,
    agentStats,
    dailyStats,
    weeklyStats,
  };
}
