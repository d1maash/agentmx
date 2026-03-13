import React from "react";
import { render } from "ink";
import { createAdapters } from "../../adapters/factory.js";
import { App } from "../../tui/App.js";
import { ProcessManager } from "../../core/process-manager.js";
import type { Config } from "../../config/schema.js";
import {
  printRunTargetError,
  resolveRunTargets,
} from "./run-targets.js";

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

  const pm = new ProcessManager(process.cwd());

  const cleanup = async () => {
    await pm.stopAll();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

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
