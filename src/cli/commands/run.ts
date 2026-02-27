import React from "react";
import { render } from "ink";
import { App } from "../../tui/App.js";
import { ProcessManager } from "../../core/process-manager.js";
import { Router } from "../../core/router.js";
import type { Config } from "../../config/schema.js";

interface RunOptions {
  agent?: string;
  parallel?: string;
}

export async function runCommand(
  task: string,
  options: RunOptions,
  config: Config
): Promise<void> {
  const pm = new ProcessManager();

  // Graceful shutdown
  const cleanup = async () => {
    await pm.stopAll();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  let initialAgent: string | undefined;
  let parallelAgents: string[] | undefined;
  let splitView = false;

  if (options.parallel) {
    // Parallel mode: run on multiple agents
    parallelAgents = options.parallel.split(",").map((s) => s.trim());
    splitView = true;
  } else if (options.agent && options.agent !== "auto") {
    // Specific agent
    initialAgent = options.agent;
  } else {
    // Auto-route
    const router = new Router(config);
    initialAgent = await router.route(task);
  }

  const { waitUntilExit } = render(
    React.createElement(App, {
      processManager: pm,
      config,
      initialTask: task,
      initialAgent,
      parallelAgents,
      splitView,
    })
  );

  await waitUntilExit();
  await pm.stopAll();
}
