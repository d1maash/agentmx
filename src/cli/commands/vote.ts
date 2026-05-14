import { ProcessManager } from "../../core/process-manager.js";
import { VotingSession, type VotingStrategy } from "../../core/voting.js";
import { createAdapters } from "../../adapters/factory.js";
import type { Config } from "../../config/schema.js";
import chalk from "chalk";

function parseMaxCost(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`--max-cost must be a positive number; got "${raw}"`);
  }
  return n;
}

interface VoteOptions {
  agents?: string;
  judge?: string;
  strategy?: string;
  isolate?: boolean;
  applyWinner?: boolean;
  keepWorktrees?: boolean;
  maxCost?: string;
}

export async function voteCommand(
  task: string,
  options: VoteOptions,
  config: Config
): Promise<void> {
  const pm = new ProcessManager();
  const adapters = createAdapters(config);

  const cleanup = async () => {
    await pm.stopAll();
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Parse agents
  let agentNames: string[];
  if (options.agents) {
    agentNames = options.agents.split(",").map((s) => s.trim());
  } else {
    agentNames = Array.from(adapters.keys());
  }

  // Validate agents
  for (const name of agentNames) {
    if (!adapters.has(name)) {
      console.error(chalk.red(`Unknown or disabled agent: ${name}`));
      console.error(
        chalk.dim(
          `Available agents: ${Array.from(adapters.keys()).join(", ")}`
        )
      );
      process.exitCode = 1;
      return;
    }
  }

  if (agentNames.length < 2) {
    console.error(chalk.red("Voting requires at least 2 agents."));
    process.exitCode = 1;
    return;
  }

  // Judge defaults to first agent
  const judgeAgent = options.judge ?? agentNames[0];
  if (!adapters.has(judgeAgent)) {
    console.error(chalk.red(`Judge agent "${judgeAgent}" not found.`));
    process.exitCode = 1;
    return;
  }

  const strategy = (options.strategy ?? "best") as VotingStrategy;
  if (strategy !== "best" && strategy !== "merge") {
    console.error(chalk.red('Strategy must be "best" or "merge".'));
    process.exitCode = 1;
    return;
  }

  const isolate = options.isolate ?? config.parallel.isolate;
  const maxCostUsd = parseMaxCost(options.maxCost) ?? config.budgets.hard_stop_per_run;

  console.log(chalk.bold("\nVoting Session"));
  console.log(chalk.dim(`  Task: "${task}"`));
  console.log(chalk.dim(`  Agents: ${agentNames.join(", ")}`));
  console.log(chalk.dim(`  Judge: ${judgeAgent}`));
  console.log(chalk.dim(`  Strategy: ${strategy}`));
  if (isolate) console.log(chalk.dim(`  Isolation: per-candidate git worktree`));
  if (maxCostUsd) console.log(chalk.dim(`  Hard-stop: $${maxCostUsd.toFixed(2)} per candidate`));
  console.log();

  const voting = new VotingSession(
    agentNames,
    judgeAgent,
    strategy,
    pm,
    adapters
  );

  pm.on("budget:hardstop", (info: { agent: string; cost: number; cap: number }) => {
    console.log(
      chalk.red(
        `\n[budget] ${info.agent} killed — cost $${info.cost.toFixed(4)} ≥ cap $${info.cap.toFixed(2)}\n`
      )
    );
  });

  try {
    let currentPhase = "";
    for await (const event of voting.execute(task, {
      isolate,
      cwd: process.cwd(),
      applyWinner: options.applyWinner,
      maxCostPerCandidateUsd: maxCostUsd,
      keepWorktrees: options.keepWorktrees,
    })) {
      if (event.phase !== currentPhase) {
        currentPhase = event.phase;
        if (event.phase === "collecting") {
          console.log(
            chalk.bold.cyan(
              `\n Phase 1: Collecting responses from ${agentNames.length} agents...\n`
            )
          );
        } else if (event.phase === "judging") {
          console.log(
            chalk.bold.cyan(
              `\n Phase 2: Judge (${judgeAgent}) evaluating responses...\n`
            )
          );
        }
      }

      // Stream judge output
      if (event.phase === "judging" && event.output) {
        process.stdout.write(event.output.data);
      }

      // Final results
      if (event.phase === "done" && event.result) {
        const r = event.result;

        console.log(chalk.bold("\n\n═══ Voting Results ═══\n"));

        // Show candidates summary
        for (let i = 0; i < r.candidates.length; i++) {
          const c = r.candidates[i];
          const isWinner = i === r.winnerIndex;
          const badge = isWinner ? chalk.green(" ★ WINNER") : "";
          const timeStr = (c.durationMs / 1000).toFixed(1) + "s";
          const costStr =
            c.cost !== undefined ? ` · $${c.cost.toFixed(4)}` : "";
          const exitStr =
            c.exitCode === 0
              ? chalk.green("exit 0")
              : chalk.red(`exit ${c.exitCode}`);

          console.log(
            chalk.bold(`  Candidate ${i + 1}: ${c.agent}`) +
              badge
          );
          console.log(
            chalk.dim(
              `    ${timeStr} · ${exitStr} · ${c.output.length} chars${costStr}`
            )
          );
        }

        console.log(
          chalk.dim(
            `\n  Judge time: ${(r.judgeDurationMs / 1000).toFixed(1)}s`
          )
        );

        if (r.winnerAgent) {
          console.log(
            chalk.bold.green(`\n  Winner: ${r.winnerAgent}`)
          );
          if (r.winnerWorktreePath) {
            console.log(
              chalk.dim(`    Workspace: ${r.winnerWorktreePath}${r.winnerApplied ? " (diff applied to cwd)" : ""}`)
            );
          }
        }

        console.log();
      }
    }
  } catch (err) {
    console.error(
      chalk.red(
        `\nVoting error: ${err instanceof Error ? err.message : err}`
      )
    );
    process.exitCode = 1;
  } finally {
    await pm.stopAll();
  }
}
