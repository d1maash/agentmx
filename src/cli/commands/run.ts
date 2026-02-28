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

  const cleanup = async () => {
    await pm.stopAll();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  let initialAgent: string | undefined = undefined;
  let parallelAgents: string[] | undefined = undefined;
  const splitView = Boolean(options.parallel);

  if (options.parallel) {
    parallelAgents = options.parallel.split(",").map((s) => s.trim());
  } else if (options.agent && options.agent !== "auto") {
    initialAgent = options.agent;
  } else {
    const router = new Router(config);
    initialAgent = await router.route(task);
  }

  process.stdout.write("\x1b[?1049h");
  const inkInstance = render(
    React.createElement(App, {
      processManager: pm,
      config,
      initialTask: task,
      initialAgent,
      parallelAgents,
      splitView,
    })
  );
  await inkInstance.waitUntilExit();
  process.stdout.write("\x1b[?1049l");

  await pm.stopAll();
}
