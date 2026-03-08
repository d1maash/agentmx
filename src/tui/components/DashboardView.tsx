import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { getAnalyticsSummary, type AnalyticsSummary } from "../../core/analytics.js";
import { getAgentCosts, checkBudgets, type AgentCostSummary, type BudgetAlert } from "../../core/cost-tracker.js";

interface DashboardViewProps {
  onClose: () => void;
}

type Tab = "overview" | "costs" | "daily";

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

function ScoreBar({ score, width = 15 }: { score: number; width?: number }) {
  if (score < 0) return <Text dimColor>N/A</Text>;
  const filled = Math.round((score / 100) * width);
  const empty = width - filled;
  const color = score >= 80 ? "green" : score >= 50 ? "yellow" : "red";
  return (
    <Text>
      <Text color={color}>{"█".repeat(filled)}</Text>
      <Text dimColor>{"░".repeat(empty)}</Text>
      <Text> {score}%</Text>
    </Text>
  );
}

export function DashboardView({ onClose }: DashboardViewProps) {
  const [tab, setTab] = useState<Tab>("overview");
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [costs, setCosts] = useState<AgentCostSummary[]>([]);
  const [alerts, setAlerts] = useState<BudgetAlert[]>([]);

  useEffect(() => {
    setSummary(getAnalyticsSummary());
    setCosts(getAgentCosts());
    setAlerts(checkBudgets());
  }, []);

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (input === "1") setTab("overview");
    if (input === "2") setTab("costs");
    if (input === "3") setTab("daily");
  });

  if (!summary) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text>Loading...</Text>
      </Box>
    );
  }

  const rateColor =
    summary.overallSuccessRate >= 80
      ? "green"
      : summary.overallSuccessRate >= 50
        ? "yellow"
        : "red";

  return (
    <Box flexDirection="column" width="100%" height="100%">
      {/* Header */}
      <Box paddingX={1} borderStyle="single" borderColor="cyan" width="100%">
        <Text bold color="cyan">Analytics Dashboard</Text>
        <Text> │ </Text>
        <Text inverse={tab === "overview"} color={tab === "overview" ? "cyan" : undefined}>
          {" 1:Overview "}
        </Text>
        <Text inverse={tab === "costs"} color={tab === "costs" ? "cyan" : undefined}>
          {" 2:Costs "}
        </Text>
        <Text inverse={tab === "daily"} color={tab === "daily" ? "cyan" : undefined}>
          {" 3:History "}
        </Text>
        <Text> │ </Text>
        <Text dimColor>Esc close</Text>
      </Box>

      {/* Alerts banner */}
      {alerts.length > 0 && (
        <Box paddingX={1} width="100%">
          {alerts.map((alert, i) => (
            <Text key={i} color={alert.level === "exceeded" ? "red" : "yellow"}>
              {alert.level === "exceeded" ? "⚠ " : "⚡ "}
              {alert.scope === "global" ? "Global" : alert.scope} {alert.period}:{" "}
              {formatCost(alert.spent)}/{formatCost(alert.limit)} ({alert.percentage.toFixed(0)}%)
              {"  "}
            </Text>
          ))}
        </Box>
      )}

      {/* Summary cards */}
      <Box paddingX={1} width="100%" gap={2}>
        <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
          <Text bold>Sessions</Text>
          <Text>{summary.totalSessions}</Text>
        </Box>
        <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
          <Text bold>Success Rate</Text>
          <Text color={rateColor}>{summary.overallSuccessRate.toFixed(1)}%</Text>
        </Box>
        <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
          <Text bold>Total Cost</Text>
          <Text>{formatCost(summary.totalCost)}</Text>
        </Box>
        <Box borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
          <Text bold>Total Time</Text>
          <Text>{formatDuration(summary.totalDurationMs)}</Text>
        </Box>
      </Box>

      {/* Tab content */}
      <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
        {tab === "overview" && <OverviewTab summary={summary} />}
        {tab === "costs" && <CostsTab costs={costs} />}
        {tab === "daily" && <HistoryTab summary={summary} />}
      </Box>
    </Box>
  );
}

function OverviewTab({ summary }: { summary: AnalyticsSummary }) {
  if (summary.agentStats.length === 0) {
    return <Text dimColor>No agent data yet. Run some tasks first!</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text bold underline>Per-Agent Statistics</Text>
      <Box flexDirection="column" marginTop={1}>
        {/* Header */}
        <Box>
          <Box width={16}><Text bold>Agent</Text></Box>
          <Box width={7}><Text bold>Tasks</Text></Box>
          <Box width={7}><Text bold>OK</Text></Box>
          <Box width={7}><Text bold>Err</Text></Box>
          <Box width={8}><Text bold>Rate</Text></Box>
          <Box width={10}><Text bold>Avg Time</Text></Box>
          <Box width={10}><Text bold>Cost</Text></Box>
        </Box>
        {/* Rows */}
        {summary.agentStats.map((s) => {
          const rateColor = s.successRate >= 80 ? "green" : s.successRate >= 50 ? "yellow" : "red";
          return (
            <Box key={s.agentName}>
              <Box width={16}><Text color="cyan">{s.agentName}</Text></Box>
              <Box width={7}><Text>{s.totalTasks}</Text></Box>
              <Box width={7}><Text color="green">{s.successCount}</Text></Box>
              <Box width={7}><Text color={s.errorCount > 0 ? "red" : undefined}>{s.errorCount}</Text></Box>
              <Box width={8}><Text color={rateColor}>{s.successRate.toFixed(0)}%</Text></Box>
              <Box width={10}><Text>{formatDuration(s.avgDurationMs)}</Text></Box>
              <Box width={10}><Text>{formatCost(s.totalCost)}</Text></Box>
            </Box>
          );
        })}
      </Box>

      {/* Token usage if available */}
      {summary.agentStats.some((s) => s.totalInputTokens > 0) && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold underline>Token Usage</Text>
          <Box flexDirection="column" marginTop={1}>
            {summary.agentStats
              .filter((s) => s.totalInputTokens > 0 || s.totalOutputTokens > 0)
              .map((s) => (
                <Box key={s.agentName}>
                  <Box width={16}><Text color="cyan">{s.agentName}</Text></Box>
                  <Text dimColor>
                    In: {(s.totalInputTokens / 1000).toFixed(1)}k | Out: {(s.totalOutputTokens / 1000).toFixed(1)}k
                  </Text>
                </Box>
              ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}

function CostsTab({ costs }: { costs: AgentCostSummary[] }) {
  if (costs.length === 0) {
    return <Text dimColor>No cost data available.</Text>;
  }

  const totalToday = costs.reduce((s, c) => s + c.todayCost, 0);
  const totalWeek = costs.reduce((s, c) => s + c.weekCost, 0);
  const totalMonth = costs.reduce((s, c) => s + c.monthCost, 0);
  const totalAll = costs.reduce((s, c) => s + c.totalCost, 0);

  return (
    <Box flexDirection="column">
      <Text bold underline>Cost Breakdown</Text>
      <Box flexDirection="column" marginTop={1}>
        {/* Header */}
        <Box>
          <Box width={16}><Text bold>Agent</Text></Box>
          <Box width={10}><Text bold>Today</Text></Box>
          <Box width={12}><Text bold>This Week</Text></Box>
          <Box width={12}><Text bold>This Month</Text></Box>
          <Box width={10}><Text bold>Total</Text></Box>
          <Box width={12}><Text bold>Avg/Session</Text></Box>
        </Box>
        {/* Rows */}
        {costs.map((c) => (
          <Box key={c.agentName}>
            <Box width={16}><Text color="cyan">{c.agentName}</Text></Box>
            <Box width={10}><Text>{formatCost(c.todayCost)}</Text></Box>
            <Box width={12}><Text>{formatCost(c.weekCost)}</Text></Box>
            <Box width={12}><Text>{formatCost(c.monthCost)}</Text></Box>
            <Box width={10}><Text bold>{formatCost(c.totalCost)}</Text></Box>
            <Box width={12}><Text dimColor>{formatCost(c.avgCostPerSession)}</Text></Box>
          </Box>
        ))}
        {/* Totals */}
        <Box marginTop={1}>
          <Box width={16}><Text bold>TOTAL</Text></Box>
          <Box width={10}><Text bold>{formatCost(totalToday)}</Text></Box>
          <Box width={12}><Text bold>{formatCost(totalWeek)}</Text></Box>
          <Box width={12}><Text bold>{formatCost(totalMonth)}</Text></Box>
          <Box width={10}><Text bold>{formatCost(totalAll)}</Text></Box>
        </Box>
      </Box>
    </Box>
  );
}

function HistoryTab({ summary }: { summary: AnalyticsSummary }) {
  const dailyStats = summary.dailyStats.slice(-14);
  const weeklyStats = summary.weeklyStats.slice(-8);

  return (
    <Box flexDirection="column">
      {/* Daily */}
      <Text bold underline>Daily History (last 14 days)</Text>
      <Box flexDirection="column" marginTop={1}>
        <Box>
          <Box width={12}><Text bold>Date</Text></Box>
          <Box width={7}><Text bold>Tasks</Text></Box>
          <Box width={5}><Text bold>OK</Text></Box>
          <Box width={5}><Text bold>Err</Text></Box>
          <Box width={10}><Text bold>Cost</Text></Box>
          <Box width={30}><Text bold>Agents</Text></Box>
        </Box>
        {dailyStats.length === 0 && <Text dimColor>No daily data.</Text>}
        {dailyStats.map((d) => {
          const agents = Object.entries(d.agentBreakdown)
            .map(([name, count]) => `${name}:${count}`)
            .join(", ");
          return (
            <Box key={d.date}>
              <Box width={12}><Text>{d.date}</Text></Box>
              <Box width={7}><Text>{d.taskCount}</Text></Box>
              <Box width={5}><Text color="green">{d.successCount}</Text></Box>
              <Box width={5}><Text color={d.errorCount > 0 ? "red" : undefined}>{d.errorCount}</Text></Box>
              <Box width={10}><Text>{formatCost(d.totalCost)}</Text></Box>
              <Box width={30}><Text dimColor>{agents}</Text></Box>
            </Box>
          );
        })}
      </Box>

      {/* Weekly */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold underline>Weekly History (last 8 weeks)</Text>
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Box width={25}><Text bold>Week</Text></Box>
            <Box width={7}><Text bold>Tasks</Text></Box>
            <Box width={5}><Text bold>OK</Text></Box>
            <Box width={5}><Text bold>Err</Text></Box>
            <Box width={10}><Text bold>Cost</Text></Box>
            <Box width={10}><Text bold>Time</Text></Box>
          </Box>
          {weeklyStats.length === 0 && <Text dimColor>No weekly data.</Text>}
          {weeklyStats.map((w) => (
            <Box key={w.weekStart}>
              <Box width={25}><Text>{w.weekStart} → {w.weekEnd}</Text></Box>
              <Box width={7}><Text>{w.taskCount}</Text></Box>
              <Box width={5}><Text color="green">{w.successCount}</Text></Box>
              <Box width={5}><Text color={w.errorCount > 0 ? "red" : undefined}>{w.errorCount}</Text></Box>
              <Box width={10}><Text>{formatCost(w.totalCost)}</Text></Box>
              <Box width={10}><Text>{formatDuration(w.totalDurationMs)}</Text></Box>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}
