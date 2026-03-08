#!/usr/bin/env node
import { Command } from "commander";
import { createRequire } from "node:module";
import { loadConfig } from "../config/loader.js";
import { interactiveCommand } from "./commands/interactive.js";
import { runCommand } from "./commands/run.js";
import { pipeCommand } from "./commands/pipe.js";
import { benchCommand } from "./commands/bench.js";
import { benchSuiteCommand } from "./commands/bench-suite.js";
import { initCommand } from "./commands/init.js";
import { resumeCommand } from "./commands/resume.js";
import { sessionsCommand } from "./commands/sessions.js";
import { voteCommand } from "./commands/vote.js";
import { reviewCommand } from "./commands/review.js";
import { shareCommand } from "./commands/share.js";
import { statsCommand } from "./commands/stats.js";
import { costsCommand } from "./commands/costs.js";
import { qualityCommand } from "./commands/quality.js";

const require = createRequire(import.meta.url);
const { version } = require("../../package.json");

const program = new Command();

program
  .name("agentmx")
  .description("Multi-agent CLI orchestrator for AI coding agents")
  .version(version);

// Interactive mode (default)
program
  .command("interactive", { isDefault: true })
  .description("Launch interactive TUI")
  .action(async () => {
    const config = await loadConfig();
    await interactiveCommand(config);
  });

// Run a task
program
  .command("run <task>")
  .description("Run a task with an agent")
  .option("-a, --agent <name>", "Agent to use", "auto")
  .option(
    "-p, --parallel <agents>",
    "Run on multiple agents in parallel (comma-separated)"
  )
  .action(async (task: string, opts: { agent?: string; parallel?: string }) => {
    const config = await loadConfig();
    await runCommand(task, opts, config);
  });

// Pipeline mode
program
  .command("pipe <steps...>")
  .description(
    'Run agents in a pipeline. Format: "agent: task" for each step'
  )
  .action(async (steps: string[]) => {
    const config = await loadConfig();
    await pipeCommand(steps, config);
  });

// Benchmark mode
const benchCmd = program
  .command("bench [task]")
  .description("Benchmark a task across agents and compare results")
  .option(
    "-a, --agents <list>",
    "Agents to benchmark (comma-separated, default: all enabled)"
  )
  .action(async (task: string | undefined, opts: { agents?: string }) => {
    if (!task) {
      console.error("Usage: amx bench <task> or amx bench suite [options]");
      process.exitCode = 1;
      return;
    }
    const config = await loadConfig();
    await benchCommand(task, opts, config);
  });

// Benchmark suite subcommand
benchCmd
  .command("suite")
  .description("Run curated benchmark suites with automated verification")
  .option("-s, --suite <id>", "Run a specific suite (e.g. algorithms, practical)")
  .option("-a, --agents <list>", "Agents to benchmark (comma-separated)")
  .option("-o, --output <path>", "Output path for markdown report")
  .option("--list", "List available suites")
  .option("--keep-workspaces", "Keep temp directories after run")
  .action(
    async (opts: {
      suite?: string;
      agents?: string;
      output?: string;
      list?: boolean;
      keepWorkspaces?: boolean;
    }) => {
      const config = await loadConfig();
      await benchSuiteCommand(opts, config);
    }
  );

// Resume a saved session
program
  .command("resume [session-id]")
  .description("Resume a previously saved session")
  .action(async (sessionId?: string) => {
    const config = await loadConfig();
    await resumeCommand(sessionId, config);
  });

// List saved sessions
program
  .command("sessions")
  .description("List saved sessions")
  .option("--clear", "Delete all saved sessions")
  .option("--delete <id>", "Delete a specific session")
  .action(async (opts: { clear?: boolean; delete?: string }) => {
    await sessionsCommand(opts);
  });

// Vote / consensus mode
program
  .command("vote <task>")
  .description(
    "Run a task on multiple agents and let a judge pick the best (or merge results)"
  )
  .option(
    "-a, --agents <list>",
    "Agents to vote (comma-separated, default: all enabled)"
  )
  .option("-j, --judge <agent>", "Judge agent (default: first agent)")
  .option(
    "-s, --strategy <strategy>",
    'Voting strategy: "best" or "merge" (default: best)'
  )
  .action(
    async (
      task: string,
      opts: { agents?: string; judge?: string; strategy?: string }
    ) => {
      const config = await loadConfig();
      await voteCommand(task, opts, config);
    }
  );

// Review pipeline
program
  .command("review <task>")
  .description(
    "Run a code review pipeline: coder → reviewer → tester"
  )
  .option("--coder <agent>", "Agent that writes code")
  .option("--reviewer <agent>", "Agent that reviews code")
  .option("--tester <agent>", "Agent that writes tests")
  .action(
    async (
      task: string,
      opts: { coder?: string; reviewer?: string; tester?: string }
    ) => {
      const config = await loadConfig();
      await reviewCommand(task, opts, config);
    }
  );

// Shared context mode
program
  .command("share <task>")
  .description(
    "Run a task on multiple agents with real-time context sharing between them"
  )
  .option(
    "-a, --agents <list>",
    "Agents to run (comma-separated, default: all enabled)"
  )
  .action(async (task: string, opts: { agents?: string }) => {
    const config = await loadConfig();
    await shareCommand(task, opts, config);
  });

// Config info
program
  .command("config")
  .description("Show current configuration")
  .action(async () => {
    const config = await loadConfig();
    console.log(JSON.stringify(config, null, 2));
  });

// Analytics dashboard
program
  .command("stats")
  .description("Show analytics dashboard with agent statistics")
  .option("-d, --days <n>", "Limit to last N days")
  .option("--no-daily", "Hide daily breakdown")
  .option("--no-weekly", "Hide weekly breakdown")
  .action(async (opts: { days?: string; daily?: boolean; weekly?: boolean }) => {
    await statsCommand(opts);
  });

// Cost tracking
program
  .command("costs")
  .description("Track costs per agent with budget limits")
  .option("--set-budget <agent>", "Set budget for an agent")
  .option("--set-global-budget", "Set global budget limits")
  .option("--daily <amount>", "Daily limit in USD")
  .option("--weekly <amount>", "Weekly limit in USD")
  .option("--monthly <amount>", "Monthly limit in USD")
  .option("--total <amount>", "Total cumulative limit in USD")
  .option("--budgets", "Show current budget configuration")
  .action(
    async (opts: {
      setBudget?: string;
      setGlobalBudget?: boolean;
      daily?: string;
      weekly?: string;
      monthly?: string;
      total?: string;
      budgets?: boolean;
    }) => {
      await costsCommand({ ...opts, showBudgets: opts.budgets });
    }
  );

// Quality scoring
program
  .command("quality")
  .description("Run quality checks: linting, tests, and complexity analysis")
  .option("-p, --path <dir>", "Directory to analyze (default: cwd)")
  .action(async (opts: { path?: string }) => {
    await qualityCommand(opts);
  });

// Init — interactive setup
program
  .command("init")
  .description("Interactive setup: detect agents and create .agentmx.yml")
  .action(async () => {
    await initCommand();
  });

program.parse();
