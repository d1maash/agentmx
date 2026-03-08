import React from "react";
import { render } from "ink";
import { App } from "../../tui/App.js";
import { ProcessManager } from "../../core/process-manager.js";
import { ContextBus } from "../../core/context-bus.js";
import { createAdapters } from "../../adapters/factory.js";
import type { Config } from "../../config/schema.js";
import chalk from "chalk";

interface ShareOptions {
  agents?: string;
}

export async function shareCommand(
  task: string,
  options: ShareOptions,
  config: Config
): Promise<void> {
  const pm = new ProcessManager();
  const adapters = createAdapters(config);
  const contextBus = new ContextBus(pm);

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
    console.error(
      chalk.red("Context sharing requires at least 2 agents.")
    );
    process.exitCode = 1;
    return;
  }

  const cleanup = async () => {
    contextBus.disconnectAll();
    await pm.stopAll();
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Connect agents to context bus when sessions start
  pm.on("session:start", (session) => {
    try {
      contextBus.connect(session.id, session.agentName);
    } catch {
      // Session may already be disconnected
    }
  });

  pm.on("session:end", (session) => {
    contextBus.disconnect(session.id);
  });

  pm.on("session:stop", (session) => {
    contextBus.disconnect(session.id);
  });

  // Launch TUI with parallel agents and context sharing enabled
  process.stdout.write("\x1b[?1049h");
  const inkInstance = render(
    React.createElement(App, {
      processManager: pm,
      config,
      initialTask: task,
      parallelAgents: agentNames,
      splitView: true,
    })
  );

  await inkInstance.waitUntilExit();
  process.stdout.write("\x1b[?1049l");

  contextBus.disconnectAll();
  await pm.stopAll();
}
