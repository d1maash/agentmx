import chalk from "chalk";
import { getAnalyticsSummary, type AgentStats, type DailyStats, type WeeklyStats } from "../../core/analytics.js";

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

function pad(str: string, len: number, align: "left" | "right" = "left"): string {
  const stripped = str.replace(/\u001b\[[0-9;]*m/g, "");
  const diff = len - stripped.length;
  if (diff <= 0) return str;
  return align === "right" ? " ".repeat(diff) + str : str + " ".repeat(diff);
}

function printAgentTable(stats: AgentStats[]): void {
  if (stats.length === 0) {
    console.log(chalk.dim("  No agent data available."));
    return;
  }

  const headers = ["Agent", "Tasks", "Success", "Errors", "Rate", "Avg Time", "Total Cost", "Avg Cost"];
  const widths = [16, 7, 9, 8, 8, 10, 12, 10];

  // Header
  const headerLine = headers.map((h, i) => pad(chalk.bold(h), widths[i])).join("  ");
  console.log(headerLine);
  console.log(chalk.dim("─".repeat(widths.reduce((a, b) => a + b, 0) + (widths.length - 1) * 2)));

  for (const s of stats) {
    const rateColor = s.successRate >= 80 ? "green" : s.successRate >= 50 ? "yellow" : "red";
    const row = [
      pad(chalk.cyan(s.agentName), widths[0]),
      pad(String(s.totalTasks), widths[1], "right"),
      pad(chalk.green(String(s.successCount)), widths[2], "right"),
      pad(s.errorCount > 0 ? chalk.red(String(s.errorCount)) : "0", widths[3], "right"),
      pad(chalk[rateColor](`${s.successRate.toFixed(0)}%`), widths[4], "right"),
      pad(formatDuration(s.avgDurationMs), widths[5], "right"),
      pad(formatCost(s.totalCost), widths[6], "right"),
      pad(formatCost(s.avgCost), widths[7], "right"),
    ];
    console.log(row.join("  "));
  }
}

function printDailyTable(stats: DailyStats[]): void {
  if (stats.length === 0) return;

  // Show last 14 days
  const recent = stats.slice(-14);

  const headers = ["Date", "Tasks", "OK", "Err", "Cost", "Agents"];
  const widths = [12, 7, 5, 5, 10, 30];

  console.log();
  console.log(chalk.bold.underline("Daily Breakdown (last 14 days)"));
  console.log();

  const headerLine = headers.map((h, i) => pad(chalk.bold(h), widths[i])).join("  ");
  console.log(headerLine);
  console.log(chalk.dim("─".repeat(widths.reduce((a, b) => a + b, 0) + (widths.length - 1) * 2)));

  for (const d of recent) {
    const agents = Object.entries(d.agentBreakdown)
      .map(([name, count]) => `${name}:${count}`)
      .join(", ");

    const row = [
      pad(d.date, widths[0]),
      pad(String(d.taskCount), widths[1], "right"),
      pad(chalk.green(String(d.successCount)), widths[2], "right"),
      pad(d.errorCount > 0 ? chalk.red(String(d.errorCount)) : "0", widths[3], "right"),
      pad(formatCost(d.totalCost), widths[4], "right"),
      pad(chalk.dim(agents), widths[5]),
    ];
    console.log(row.join("  "));
  }
}

function printWeeklyTable(stats: WeeklyStats[]): void {
  if (stats.length === 0) return;

  const recent = stats.slice(-8);

  const headers = ["Week", "Tasks", "OK", "Err", "Cost", "Time"];
  const widths = [25, 7, 5, 5, 10, 10];

  console.log();
  console.log(chalk.bold.underline("Weekly Breakdown (last 8 weeks)"));
  console.log();

  const headerLine = headers.map((h, i) => pad(chalk.bold(h), widths[i])).join("  ");
  console.log(headerLine);
  console.log(chalk.dim("─".repeat(widths.reduce((a, b) => a + b, 0) + (widths.length - 1) * 2)));

  for (const w of recent) {
    const row = [
      pad(`${w.weekStart} → ${w.weekEnd}`, widths[0]),
      pad(String(w.taskCount), widths[1], "right"),
      pad(chalk.green(String(w.successCount)), widths[2], "right"),
      pad(w.errorCount > 0 ? chalk.red(String(w.errorCount)) : "0", widths[3], "right"),
      pad(formatCost(w.totalCost), widths[4], "right"),
      pad(formatDuration(w.totalDurationMs), widths[5], "right"),
    ];
    console.log(row.join("  "));
  }
}

export async function statsCommand(opts: { days?: string; weekly?: boolean; daily?: boolean }): Promise<void> {
  const days = opts.days ? parseInt(opts.days, 10) : undefined;
  const summary = getAnalyticsSummary(days);

  if (summary.totalSessions === 0) {
    console.log(chalk.yellow("No session data found. Run some tasks first!"));
    return;
  }

  // Summary header
  console.log();
  console.log(chalk.bold.underline("AgentMX Analytics Dashboard"));
  console.log();

  const period = days ? `last ${days} days` : "all time";
  console.log(chalk.dim(`Period: ${period}`));
  console.log();

  // Overview cards
  const overallRate = summary.overallSuccessRate;
  const rateColor = overallRate >= 80 ? "green" : overallRate >= 50 ? "yellow" : "red";

  console.log(`  ${chalk.bold("Total Sessions:")}  ${summary.totalSessions}`);
  console.log(`  ${chalk.bold("Success Rate:")}    ${chalk[rateColor](`${overallRate.toFixed(1)}%`)}`);
  console.log(`  ${chalk.bold("Total Cost:")}      ${formatCost(summary.totalCost)}`);
  console.log(`  ${chalk.bold("Total Time:")}      ${formatDuration(summary.totalDurationMs)}`);
  console.log();

  // Agent stats table
  console.log(chalk.bold.underline("Per-Agent Statistics"));
  console.log();
  printAgentTable(summary.agentStats);

  // Daily breakdown
  if (opts.daily !== false) {
    printDailyTable(summary.dailyStats);
  }

  // Weekly breakdown
  if (opts.weekly !== false) {
    printWeeklyTable(summary.weeklyStats);
  }

  console.log();
}
