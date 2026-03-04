#!/usr/bin/env node
import { Command } from "commander";
import { createRequire } from "node:module";
import { loadConfig } from "../config/loader.js";
import { interactiveCommand } from "./commands/interactive.js";
import { runCommand } from "./commands/run.js";
import { pipeCommand } from "./commands/pipe.js";
import { benchCommand } from "./commands/bench.js";
import { initCommand } from "./commands/init.js";
import { resumeCommand } from "./commands/resume.js";
import { sessionsCommand } from "./commands/sessions.js";

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
program
  .command("bench <task>")
  .description("Benchmark a task across agents and compare results")
  .option(
    "-a, --agents <list>",
    "Agents to benchmark (comma-separated, default: all enabled)"
  )
  .action(async (task: string, opts: { agents?: string }) => {
    const config = await loadConfig();
    await benchCommand(task, opts, config);
  });

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

// Config info
program
  .command("config")
  .description("Show current configuration")
  .action(async () => {
    const config = await loadConfig();
    console.log(JSON.stringify(config, null, 2));
  });

// Init — interactive setup
program
  .command("init")
  .description("Interactive setup: detect agents and create .agentmx.yml")
  .action(async () => {
    await initCommand();
  });

program.parse();
