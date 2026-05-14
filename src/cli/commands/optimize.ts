import chalk from "chalk";
import { createAdapters } from "../../adapters/factory.js";
import {
  escalateUntilPass,
  raceUntilPass,
  type OptimizerOutcome,
  type OptimizerTier,
  type TierResult,
} from "../../core/optimizer.js";
import { ProcessManager } from "../../core/process-manager.js";
import type { Config } from "../../config/schema.js";

export interface OptimizeOptions {
  /** Comma-separated list of agents in cheap → expensive order. */
  tiers?: string;
  /** Run all tiers in parallel and stop at first verified pass. */
  race?: boolean;
  /** Skip verification (use raw exit codes for success detection). */
  noVerify?: boolean;
  /** Optional per-tier timeout in seconds. */
  timeout?: string;
  /** Skip lint during verification (tests only). */
  testsOnly?: boolean;
  /** Allocate a fresh git worktree per tier. */
  isolate?: boolean;
  /** Keep worktrees on disk after the run. */
  keepWorktrees?: boolean;
  /** Hard cost cap per tier (USD). */
  maxCost?: string;
}

const DEFAULT_TIERS: { agent: string; label: string }[] = [
  { agent: "codex", label: "cheap" },
  { agent: "claude-code", label: "expensive" },
];

export async function optimizeCommand(
  task: string,
  options: OptimizeOptions,
  config: Config
): Promise<void> {
  const adapters = createAdapters(config);
  const tiers = resolveTiers(options, adapters);

  if (tiers.length === 0) {
    console.error(
      chalk.red("optimize: no usable agents — pass --tiers <a,b,...> with enabled agents.")
    );
    process.exitCode = 1;
    return;
  }

  const pm = new ProcessManager(process.cwd());

  const cleanup = async () => {
    await pm.stopAll();
    process.exit(130);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  const timeoutMs = options.timeout
    ? parseInt(options.timeout, 10) * 1000
    : undefined;
  if (timeoutMs !== undefined) {
    for (const t of tiers) t.timeoutMs = timeoutMs;
  }

  const mode: "race" | "escalate" = options.race ? "race" : "escalate";
  const isolate = options.isolate ?? config.parallel.isolate;
  const maxCostUsd = parseMaxCost(options.maxCost) ?? config.budgets.hard_stop_per_run;

  console.log(chalk.bold.underline("\nAgentMX Cost Optimizer"));
  console.log(chalk.dim(`  Mode:  ${mode}`));
  console.log(chalk.dim(`  Task:  ${task}`));
  console.log(
    chalk.dim(
      `  Tiers: ${tiers
        .map((t, i) => `${i + 1}. ${t.label ?? t.agent} (${t.agent})`)
        .join(" → ")}`
    )
  );
  if (isolate) console.log(chalk.dim(`  Isolation: per-tier git worktree`));
  if (maxCostUsd) console.log(chalk.dim(`  Hard-stop: $${maxCostUsd.toFixed(2)} per tier`));
  console.log();

  pm.on("budget:hardstop", (info: { agent: string; cost: number; cap: number }) => {
    console.log(
      chalk.red(`[budget] ${info.agent} killed — cost $${info.cost.toFixed(4)} ≥ cap $${info.cap.toFixed(2)}`)
    );
  });

  const verifyOverrides = options.testsOnly
    ? { runLint: false, runTypecheck: false }
    : undefined;

  const onTierStart = (tier: OptimizerTier, index: number) => {
    console.log(
      chalk.bold.cyan(`▶ Tier ${index + 1} — ${tier.label ?? tier.agent} (${tier.agent})`)
    );
  };
  const onTierEnd = (result: TierResult) => {
    const verdict =
      result.verdict === "pass"
        ? chalk.green("PASS")
        : result.abortedReason
          ? chalk.yellow(`SKIP (${result.abortedReason})`)
          : chalk.red("FAIL");
    console.log(
      `  ${verdict}  exit=${result.exitCode}  cost=${formatCost(result.cost)}  ${formatDuration(result.durationMs)}`
    );
    if (result.proof && result.verdict === "fail") {
      const failingChecks = result.proof.checks
        .filter((c) => c.status === "fail" && c.weight > 0)
        .map((c) => c.name);
      if (failingChecks.length > 0) {
        console.log(chalk.dim(`    failing: ${failingChecks.join(", ")}`));
      }
    }
  };
  const onOutput = (tier: OptimizerTier, chunk: string) => {
    // Only stream in escalate mode — race mode would interleave too much.
    if (mode === "escalate") {
      process.stdout.write(chunk);
    } else {
      void tier;
      void chunk;
    }
  };

  const runner = mode === "race" ? raceUntilPass : escalateUntilPass;
  const outcome = await runner(task, tiers, pm, adapters, {
    cwd: process.cwd(),
    skipVerify: options.noVerify,
    verifyOverrides,
    onTierStart,
    onTierEnd,
    onOutput,
    isolate,
    keepWorktrees: options.keepWorktrees,
    maxCostPerTierUsd: maxCostUsd,
  });

  await pm.stopAll();
  process.off("SIGINT", cleanup);
  process.off("SIGTERM", cleanup);

  printOutcome(outcome);
  process.exitCode = outcome.success ? 0 : 1;
}

function resolveTiers(
  options: OptimizeOptions,
  adapters: Map<string, unknown>
): OptimizerTier[] {
  if (options.tiers) {
    const names = options.tiers
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const tiers: OptimizerTier[] = [];
    for (let i = 0; i < names.length; i++) {
      const agent = names[i];
      if (!adapters.has(agent)) {
        console.error(chalk.red(`Unknown or disabled agent: ${agent}`));
        continue;
      }
      tiers.push({
        agent,
        label: i === 0 ? "cheap" : i === names.length - 1 ? "expensive" : `tier-${i + 1}`,
      });
    }
    return tiers;
  }
  return DEFAULT_TIERS.filter((t) => adapters.has(t.agent));
}

function printOutcome(outcome: OptimizerOutcome): void {
  console.log();
  console.log(chalk.bold.underline("Outcome"));

  if (outcome.success && outcome.winner) {
    const w = outcome.winner;
    console.log(
      `  ${chalk.green("✓ PASS")} via ${chalk.cyan(w.tier.agent)} (${w.tier.label ?? "tier"})`
    );
    console.log(`  Winner cost:           ${formatCost(w.cost)}`);
    console.log(
      `  ${chalk.bold("Cost of successful PR:")} ${chalk.bold.green(formatCost(outcome.totalCost))}`
    );
    if (outcome.attempts.length > 1) {
      const wasted = outcome.totalCost - w.cost;
      if (wasted > 0) {
        console.log(
          chalk.dim(`    (includes ${formatCost(wasted)} burned on prior/sibling attempts)`)
        );
      }
    }
  } else {
    console.log(`  ${chalk.red("✗ FAIL")} — no tier produced a passing patch`);
    console.log(`  Total cost burned:     ${formatCost(outcome.totalCost)}`);
  }

  console.log();
  console.log(chalk.dim("  Per-tier breakdown:"));
  for (const a of outcome.attempts) {
    const status =
      a.verdict === "pass"
        ? chalk.green("pass")
        : a.abortedReason
          ? chalk.yellow("abort")
          : chalk.red("fail");
    console.log(
      `    ${status}  ${a.tier.agent.padEnd(14)} ${formatCost(a.cost).padStart(10)}  ${formatDuration(a.durationMs)}`
    );
  }
  console.log();
}

function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

function parseMaxCost(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`--max-cost must be a positive number; got "${raw}"`);
  }
  return n;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m${s}s`;
}
