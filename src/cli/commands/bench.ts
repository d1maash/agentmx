import React from "react";
import { render } from "ink";
import { ProcessManager } from "../../core/process-manager.js";
import { createAdapters } from "../../adapters/factory.js";
import { BenchView } from "../../tui/components/BenchView.js";
import type { Config } from "../../config/schema.js";
import chalk from "chalk";

interface BenchOptions {
  agents?: string;
}

export async function benchCommand(
  task: string,
  options: BenchOptions,
  config: Config
): Promise<void> {
  const pm = new ProcessManager();
  const adapters = createAdapters(config);

  // Filter to requested agents (or all enabled)
  let agentNames: string[];
  if (options.agents) {
    agentNames = options.agents.split(",").map((s) => s.trim());
    // Validate that requested agents exist
    for (const name of agentNames) {
      if (!adapters.has(name)) {
        console.error(
          chalk.red(`Unknown or disabled agent: ${name}`)
        );
        console.error(
          chalk.dim(
            `Available agents: ${Array.from(adapters.keys()).join(", ")}`
          )
        );
        process.exitCode = 1;
        return;
      }
    }
  } else {
    agentNames = Array.from(adapters.keys());
  }

  if (agentNames.length === 0) {
    console.error(chalk.red("No agents available to benchmark."));
    process.exitCode = 1;
    return;
  }

  // Graceful shutdown
  const cleanup = async () => {
    await pm.stopAll();
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Start all agents in parallel
  const sessionIds = new Map<string, string>();
  const displayNames = new Map<string, string>();

  console.log(
    chalk.bold(`\nBenchmarking ${agentNames.length} agent(s): `) +
      agentNames.join(", ")
  );
  console.log(chalk.dim(`Task: "${task}"\n`));

  for (const name of agentNames) {
    const adapter = adapters.get(name)!;
    displayNames.set(name, adapter.info.displayName);
    try {
      const sessionId = await pm.start(adapter, task);
      sessionIds.set(name, sessionId);
    } catch (err) {
      console.error(
        chalk.red(
          `Failed to start ${name}: ${err instanceof Error ? err.message : err}`
        )
      );
    }
  }

  if (sessionIds.size === 0) {
    console.error(chalk.red("No agents could be started."));
    await pm.stopAll();
    process.exitCode = 1;
    return;
  }

  // Render the bench TUI
  const inkInstance = render(
    React.createElement(BenchView, {
      task,
      processManager: pm,
      sessionIds,
      displayNames,
    })
  );

  await inkInstance.waitUntilExit();

  // Print final results to stdout (copy-pasteable)
  const resultLines: Array<{
    name: string;
    time: number;
    exitCode: number | undefined;
    outputSize: number;
    cost: number | undefined;
  }> = [];

  for (const [agentName, sessionId] of sessionIds) {
    const proc = pm.get(sessionId);
    const session = pm.getSession(sessionId);
    if (!proc || !session) continue;

    const startTime = session.startedAt;
    const elapsed = Date.now() - startTime;

    let outputSize = 0;
    for (const entry of proc.buffer) {
      outputSize += entry.data.length;
    }

    let cost: number | undefined;
    for (let i = proc.buffer.length - 1; i >= 0; i--) {
      const activity = proc.buffer[i].activity;
      if (activity && activity.kind === "cost") {
        cost = activity.totalCost;
        break;
      }
    }

    resultLines.push({
      name: displayNames.get(agentName) ?? agentName,
      time: elapsed,
      exitCode: undefined, // already exited
      outputSize,
      cost,
    });
  }

  // Sort by time
  resultLines.sort((a, b) => a.time - b.time);

  if (resultLines.length > 0) {
    const maxName = Math.max(...resultLines.map((r) => r.name.length), 5);
    console.log(chalk.bold(`\nBenchmark Results — "${task}"\n`));
    console.log(
      chalk.dim(
        "  #  " +
          "Agent".padEnd(maxName) +
          "   Time      Exit   Output      Cost"
      )
    );
    console.log(chalk.dim("  " + "─".repeat(maxName + 45)));

    for (let i = 0; i < resultLines.length; i++) {
      const r = resultLines[i];
      const timeStr = (r.time / 1000).toFixed(1) + "s";
      const exitStr = r.exitCode !== undefined ? String(r.exitCode) : "—";
      const sizeStr =
        r.outputSize < 1024
          ? r.outputSize + " B"
          : (r.outputSize / 1024).toFixed(1) + " KB";
      const costStr =
        r.cost !== undefined ? "$" + r.cost.toFixed(4) : "—";

      console.log(
        `  ${i + 1}  ${r.name.padEnd(maxName)}  ${timeStr.padStart(7)}  ${exitStr.padStart(5)}   ${sizeStr.padStart(8)}  ${costStr.padStart(8)}`
      );
    }

    const fastest = resultLines[0];
    console.log(
      chalk.bold.green(
        `\n  Fastest: ${fastest.name} (${(fastest.time / 1000).toFixed(1)}s)`
      )
    );
    console.log();
  }

  await pm.stopAll();
}
