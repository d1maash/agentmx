import chalk from "chalk";
import {
  getAgentCosts,
  checkBudgets,
  setBudget,
  setGlobalBudget,
  loadBudgetConfig,
  type AgentCostSummary,
  type BudgetAlert,
} from "../../core/cost-tracker.js";

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

function printCostTable(costs: AgentCostSummary[]): void {
  if (costs.length === 0) {
    console.log(chalk.dim("  No cost data available."));
    return;
  }

  const headers = [
    "Agent",
    "Today",
    "This Week",
    "This Month",
    "Total",
    "Sessions",
    "Avg/Session",
    "✓/Session",
    "Cost/Pass",
  ];
  const widths = [16, 10, 12, 12, 12, 10, 12, 12, 12];

  const headerLine = headers.map((h, i) => pad(chalk.bold(h), widths[i])).join("  ");
  console.log(headerLine);
  console.log(chalk.dim("─".repeat(widths.reduce((a, b) => a + b, 0) + (widths.length - 1) * 2)));

  for (const c of costs) {
    const successRatio =
      c.sessionCount > 0
        ? `${c.successCount}/${c.sessionCount}`
        : "—";
    const costPerPass =
      c.costPerSuccess !== undefined ? formatCost(c.costPerSuccess) : chalk.dim("—");
    const row = [
      pad(chalk.cyan(c.agentName), widths[0]),
      pad(formatCost(c.todayCost), widths[1], "right"),
      pad(formatCost(c.weekCost), widths[2], "right"),
      pad(formatCost(c.monthCost), widths[3], "right"),
      pad(chalk.bold(formatCost(c.totalCost)), widths[4], "right"),
      pad(String(c.sessionCount), widths[5], "right"),
      pad(formatCost(c.avgCostPerSession), widths[6], "right"),
      pad(successRatio, widths[7], "right"),
      pad(costPerPass, widths[8], "right"),
    ];
    console.log(row.join("  "));
  }

  // Totals row
  console.log(chalk.dim("─".repeat(widths.reduce((a, b) => a + b, 0) + (widths.length - 1) * 2)));
  const totals = costs.reduce(
    (acc, c) => ({
      today: acc.today + c.todayCost,
      week: acc.week + c.weekCost,
      month: acc.month + c.monthCost,
      total: acc.total + c.totalCost,
      sessions: acc.sessions + c.sessionCount,
      successes: acc.successes + c.successCount,
    }),
    { today: 0, week: 0, month: 0, total: 0, sessions: 0, successes: 0 }
  );

  const totalRow = [
    pad(chalk.bold("TOTAL"), widths[0]),
    pad(chalk.bold(formatCost(totals.today)), widths[1], "right"),
    pad(chalk.bold(formatCost(totals.week)), widths[2], "right"),
    pad(chalk.bold(formatCost(totals.month)), widths[3], "right"),
    pad(chalk.bold(formatCost(totals.total)), widths[4], "right"),
    pad(chalk.bold(String(totals.sessions)), widths[5], "right"),
    pad(formatCost(totals.sessions > 0 ? totals.total / totals.sessions : 0), widths[6], "right"),
    pad(`${totals.successes}/${totals.sessions}`, widths[7], "right"),
    pad(
      totals.successes > 0
        ? chalk.bold(formatCost(totals.total / totals.successes))
        : chalk.dim("—"),
      widths[8],
      "right"
    ),
  ];
  console.log(totalRow.join("  "));
}

function printAlerts(alerts: BudgetAlert[]): void {
  if (alerts.length === 0) return;

  console.log();
  console.log(chalk.bold.underline("Budget Alerts"));
  console.log();

  for (const alert of alerts) {
    const icon = alert.level === "exceeded" ? chalk.red("⚠ EXCEEDED") : chalk.yellow("⚡ WARNING");
    const scope = alert.scope === "global" ? "Global" : alert.scope;
    console.log(
      `  ${icon}  ${chalk.bold(scope)} ${alert.period}: ` +
      `${formatCost(alert.spent)} / ${formatCost(alert.limit)} ` +
      `(${chalk.bold(`${alert.percentage.toFixed(0)}%`)})`
    );
  }
}

function printBudgetConfig(): void {
  const config = loadBudgetConfig();

  console.log();
  console.log(chalk.bold.underline("Budget Configuration"));
  console.log();

  if (config.globalDailyLimit || config.globalWeeklyLimit || config.globalMonthlyLimit) {
    console.log("  " + chalk.bold("Global limits:"));
    if (config.globalDailyLimit) console.log(`    Daily:   ${formatCost(config.globalDailyLimit)}`);
    if (config.globalWeeklyLimit) console.log(`    Weekly:  ${formatCost(config.globalWeeklyLimit)}`);
    if (config.globalMonthlyLimit) console.log(`    Monthly: ${formatCost(config.globalMonthlyLimit)}`);
  }

  if (config.agents.length > 0) {
    console.log("  " + chalk.bold("Per-agent limits:"));
    for (const agent of config.agents) {
      console.log(`    ${chalk.cyan(agent.agentName)}:`);
      if (agent.dailyLimit) console.log(`      Daily:   ${formatCost(agent.dailyLimit)}`);
      if (agent.weeklyLimit) console.log(`      Weekly:  ${formatCost(agent.weeklyLimit)}`);
      if (agent.monthlyLimit) console.log(`      Monthly: ${formatCost(agent.monthlyLimit)}`);
      if (agent.totalLimit) console.log(`      Total:   ${formatCost(agent.totalLimit)}`);
    }
  }

  if (
    !config.globalDailyLimit &&
    !config.globalWeeklyLimit &&
    !config.globalMonthlyLimit &&
    config.agents.length === 0
  ) {
    console.log(chalk.dim("  No budgets configured."));
    console.log(chalk.dim("  Set with: amx costs --set-budget <agent> --daily <amount>"));
    console.log(chalk.dim("  Or global: amx costs --set-global-budget --daily <amount>"));
  }
}

export async function costsCommand(opts: {
  setBudget?: string;
  setGlobalBudget?: boolean;
  daily?: string;
  weekly?: string;
  monthly?: string;
  total?: string;
  showBudgets?: boolean;
}): Promise<void> {
  // Set per-agent budget
  if (opts.setBudget) {
    const limits: Record<string, number | undefined> = {};
    if (opts.daily) limits.daily = parseFloat(opts.daily);
    if (opts.weekly) limits.weekly = parseFloat(opts.weekly);
    if (opts.monthly) limits.monthly = parseFloat(opts.monthly);
    if (opts.total) limits.total = parseFloat(opts.total);

    if (!limits.daily && !limits.weekly && !limits.monthly && !limits.total) {
      console.error(chalk.red("Specify at least one limit: --daily, --weekly, --monthly, or --total"));
      process.exitCode = 1;
      return;
    }

    setBudget(opts.setBudget, limits as { daily?: number; weekly?: number; monthly?: number; total?: number });
    console.log(chalk.green(`Budget set for ${opts.setBudget}`));
    printBudgetConfig();
    return;
  }

  // Set global budget
  if (opts.setGlobalBudget) {
    const limits: Record<string, number | undefined> = {};
    if (opts.daily) limits.daily = parseFloat(opts.daily);
    if (opts.weekly) limits.weekly = parseFloat(opts.weekly);
    if (opts.monthly) limits.monthly = parseFloat(opts.monthly);

    if (!limits.daily && !limits.weekly && !limits.monthly) {
      console.error(chalk.red("Specify at least one limit: --daily, --weekly, or --monthly"));
      process.exitCode = 1;
      return;
    }

    setGlobalBudget(limits as { daily?: number; weekly?: number; monthly?: number });
    console.log(chalk.green("Global budget set"));
    printBudgetConfig();
    return;
  }

  // Show budgets
  if (opts.showBudgets) {
    printBudgetConfig();
    return;
  }

  // Default: show cost report
  const costs = getAgentCosts();

  console.log();
  console.log(chalk.bold.underline("AgentMX Cost Tracking"));
  console.log();

  printCostTable(costs);

  // Check and display alerts
  const alerts = checkBudgets();
  printAlerts(alerts);

  printBudgetConfig();

  console.log();
}
