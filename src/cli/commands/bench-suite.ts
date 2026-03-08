import React from "react";
import { render } from "ink";
import chalk from "chalk";
import { writeFileSync } from "node:fs";
import type { Config } from "../../config/schema.js";
import { createAdapters } from "../../adapters/factory.js";
import { getSuite, getAllSuites, listSuiteIds } from "../../bench/suites/index.js";
import { SuiteOrchestrator } from "../../bench/orchestrator.js";
import { generateReport } from "../../bench/report.js";
import { SuiteView } from "../../tui/components/SuiteView.js";
import type { SuiteRunResult } from "../../bench/types.js";

export interface BenchSuiteOptions {
  suite?: string;
  agents?: string;
  output?: string;
  list?: boolean;
  keepWorkspaces?: boolean;
}

export async function benchSuiteCommand(
  options: BenchSuiteOptions,
  config: Config
): Promise<void> {
  // --list: show available suites and exit
  if (options.list) {
    console.log(chalk.bold("\nAvailable benchmark suites:\n"));
    for (const suite of getAllSuites()) {
      console.log(`  ${chalk.cyan(suite.id.padEnd(15))} ${suite.name} — ${suite.description}`);
      console.log(
        chalk.dim(
          `${"".padEnd(17)}${suite.problems.length} problems: ${suite.problems.map((p) => p.name).join(", ")}`
        )
      );
      console.log();
    }
    return;
  }

  // Resolve suites
  let suites;
  if (options.suite) {
    const suite = getSuite(options.suite);
    if (!suite) {
      console.error(chalk.red(`Unknown suite: ${options.suite}`));
      console.error(chalk.dim(`Available suites: ${listSuiteIds().join(", ")}`));
      process.exitCode = 1;
      return;
    }
    suites = [suite];
  } else {
    suites = getAllSuites();
  }

  // Validate agents
  const adapters = createAdapters(config);
  let agentNames: string[] | undefined;
  if (options.agents) {
    agentNames = options.agents.split(",").map((s) => s.trim());
    for (const name of agentNames) {
      if (!adapters.has(name)) {
        console.error(chalk.red(`Unknown or disabled agent: ${name}`));
        console.error(
          chalk.dim(`Available agents: ${Array.from(adapters.keys()).join(", ")}`)
        );
        process.exitCode = 1;
        return;
      }
    }
  }

  if (adapters.size === 0) {
    console.error(chalk.red("No agents available to benchmark."));
    process.exitCode = 1;
    return;
  }

  const totalProblems = suites.reduce((sum, s) => sum + s.problems.length, 0);
  const benchAgents = agentNames ?? Array.from(adapters.keys());

  console.log(
    chalk.bold(`\nBenchmark Suite: `) +
      suites.map((s) => s.name).join(", ")
  );
  console.log(
    chalk.dim(
      `${totalProblems} problems × ${benchAgents.length} agents (${benchAgents.join(", ")})`
    )
  );
  console.log();

  // Graceful shutdown
  const cleanup = () => {
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Create orchestrator
  const orchestrator = new SuiteOrchestrator({
    suites,
    agentNames,
    keepWorkspaces: options.keepWorkspaces,
    config,
  });

  // Run with TUI
  let finalResults: SuiteRunResult[] = [];

  const inkInstance = render(
    React.createElement(SuiteView, {
      orchestrator,
      onResults: (results: SuiteRunResult[]) => {
        finalResults = results;
      },
    })
  );

  await inkInstance.waitUntilExit();

  // Generate and write report
  if (finalResults.length > 0) {
    const report = generateReport(finalResults);
    const outputPath = options.output ?? `bench-report-${Date.now()}.md`;

    writeFileSync(outputPath, report, "utf-8");
    console.log(chalk.green(`\nReport written to: ${outputPath}`));

    // Print summary to stdout
    for (const suite of finalResults) {
      console.log(chalk.bold(`\n${suite.suiteName} Results:\n`));

      for (const [agentName, results] of suite.agentResults) {
        const passed = results.filter((r) => r.passed).length;
        const total = results.length;
        const totalTime = results.reduce((sum, r) => sum + r.timeMs, 0);
        const displayName = results[0]?.displayName ?? agentName;

        const icon = passed === total ? "✅" : "❌";
        console.log(
          `  ${icon} ${displayName}: ${passed}/${total} passed in ${(totalTime / 1000).toFixed(1)}s`
        );
      }
    }
    console.log();
  }

  if (options.keepWorkspaces) {
    const workspaces = orchestrator.getWorkspaces();
    if (workspaces.length > 0) {
      console.log(chalk.dim("\nWorkspaces preserved:"));
      for (const ws of workspaces) {
        console.log(chalk.dim(`  ${ws.agentName}/${ws.problemId}: ${ws.dir}`));
      }
      console.log();
    }
  }
}
