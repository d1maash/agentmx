import React from "react";
import { render } from "ink";
import { App } from "../../tui/App.js";
import { ProcessManager } from "../../core/process-manager.js";
import { Router } from "../../core/router.js";
import { rawPassthrough } from "../../tui/raw-passthrough.js";
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

  let initialAgent: string | undefined;
  let parallelAgents: string[] | undefined;
  let splitView = false;

  if (options.parallel) {
    parallelAgents = options.parallel.split(",").map((s) => s.trim());
    splitView = true;
  } else if (options.agent && options.agent !== "auto") {
    initialAgent = options.agent;
  } else {
    const router = new Router(config);
    initialAgent = await router.route(task);
  }

  let running = true;

  while (running) {
    let focusSessionId: string | null = null;
    let quit = false;

    const onFocus = (sessionId: string) => {
      focusSessionId = sessionId;
      inkInstance.unmount();
    };

    const onQuit = async () => {
      quit = true;
      await pm.stopAll();
      inkInstance.unmount();
    };

    const inkInstance = render(
      React.createElement(App, {
        processManager: pm,
        config,
        initialTask: task,
        initialAgent,
        parallelAgents,
        splitView,
        onFocus,
        onQuit,
      })
    );

    await inkInstance.waitUntilExit();

    if (quit) {
      running = false;
      break;
    }

    if (focusSessionId) {
      await rawPassthrough(pm, focusSessionId);
    }

    // Clear initialTask so it doesn't re-spawn on re-render
    task = "";
    initialAgent = undefined;
    parallelAgents = undefined;
  }

  await pm.stopAll();
}
