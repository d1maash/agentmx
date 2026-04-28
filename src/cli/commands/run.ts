import React from "react";
import { render } from "ink";
import { createAdapters } from "../../adapters/factory.js";
import type { AgentAdapter } from "../../adapters/types.js";
import { App } from "../../tui/App.js";
import { ProcessManager } from "../../core/process-manager.js";
import type { Config } from "../../config/schema.js";
import { reviewCommand } from "./review.js";
import {
  printRunTargetError,
  resolveRunTargets,
} from "./run-targets.js";
import chalk from "chalk";

interface RunOptions {
  agent?: string;
  parallel?: string;
}

export async function runCommand(
  task: string,
  options: RunOptions,
  config: Config
): Promise<void> {
  const adapters = createAdapters(config);
  let targets;
  try {
    targets = await resolveRunTargets(task, options, config, adapters.keys());
  } catch (err) {
    printRunTargetError(err, adapters.keys());
    process.exitCode = 1;
    return;
  }

  if (targets.reviewRoles) {
    printRoutePlan(targets.routePlan);
    await reviewCommand(task, targets.reviewRoles, config);
    return;
  }

  const pm = new ProcessManager(process.cwd());

  if (targets.cheapFirst) {
    printRoutePlan(targets.routePlan);
    await runCheapFirst(task, targets.cheapFirst, pm, adapters);
    return;
  }

  const cleanup = async () => {
    await pm.stopAll();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  printRoutePlan(targets.routePlan);
  process.stdout.write("\x1b[?1049h");
  const inkInstance = render(
    React.createElement(App, {
      processManager: pm,
      config,
      initialTask: task,
      initialAgent: targets.initialAgent,
      parallelAgents: targets.parallelAgents,
      splitView: targets.splitView,
    })
  );
  await inkInstance.waitUntilExit();
  process.stdout.write("\x1b[?1049l");

  await pm.stopAll();
}

type ResolvedRoutePlan = Awaited<ReturnType<typeof resolveRunTargets>>["routePlan"];

function printRoutePlan(plan: ResolvedRoutePlan): void {
  if (!plan || plan.strategy === "single") return;
  console.log(chalk.bold(`Auto-router: ${plan.strategy}`));
  console.log(chalk.dim(`  Kind: ${plan.taskKind} · ${plan.reason}`));
  console.log(chalk.dim(`  Agents: ${plan.agents.join(", ")}\n`));
}

async function runCheapFirst(
  task: string,
  cheapFirst: { firstAgent: string; fallbackAgent: string },
  pm: ProcessManager,
  adapters: Map<string, AgentAdapter>
): Promise<void> {
  const first = adapters.get(cheapFirst.firstAgent);
  const fallback = adapters.get(cheapFirst.fallbackAgent);

  if (!first || !fallback) {
    console.error(chalk.red("Auto-router selected an unavailable agent."));
    process.exitCode = 1;
    return;
  }

  const cleanup = async () => {
    await pm.stopAll();
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  const firstExit = await runStreamingAgent(pm, first, task, "Cheap-first");
  if (firstExit === 0 || cheapFirst.firstAgent === cheapFirst.fallbackAgent) {
    await pm.stopAll();
    return;
  }

  console.log(
    chalk.yellow(
      `\nCheap-first agent exited ${firstExit}; retrying with ${cheapFirst.fallbackAgent}.\n`
    )
  );
  await runStreamingAgent(pm, fallback, task, "Fallback");
  await pm.stopAll();
}

async function runStreamingAgent(
  pm: ProcessManager,
  adapter: AgentAdapter,
  task: string,
  label: string
): Promise<number> {
  console.log(chalk.bold(`${label}: ${adapter.info.name}`));
  const sessionId = await pm.start(adapter, task);
  const proc = pm.get(sessionId);
  if (!proc) {
    throw new Error(`Failed to start ${adapter.info.name}`);
  }

  for await (const chunk of proc.output) {
    process.stdout.write(chunk.data);
  }

  const { exitCode } = await proc.done;
  console.log(chalk.dim(`\n[${adapter.info.name} exited ${exitCode}]\n`));
  return exitCode;
}
