import React from "react";
import { render } from "ink";
import { App } from "../../tui/App.js";
import { ProcessManager } from "../../core/process-manager.js";
import { Router } from "../../core/router.js";
import { rawPassthrough, rawPassthroughFresh } from "../../tui/raw-passthrough.js";
import { createAdapters } from "../../adapters/factory.js";
import type { Config } from "../../config/schema.js";

type RunAction =
  | { type: "focus"; sessionId: string }
  | { type: "start_fresh"; agentName: string }
  | { type: "quit" };

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
  const adapters = createAdapters(config);

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
    let action: RunAction | null = null;

    const onFocus = (sessionId: string) => {
      action = { type: "focus", sessionId };
      inkInstance.unmount();
    };

    const onStartFresh = (agentName: string) => {
      action = { type: "start_fresh", agentName };
      inkInstance.unmount();
    };

    const onQuit = async () => {
      action = { type: "quit" };
      await pm.stopAll();
      inkInstance.unmount();
    };

    // Enter alternate screen buffer for Ink TUI
    process.stdout.write("\x1b[?1049h");

    const inkInstance = render(
      React.createElement(App, {
        processManager: pm,
        config,
        initialTask: task,
        initialAgent,
        parallelAgents,
        splitView,
        onFocus,
        onStartFresh,
        onQuit,
      })
    );

    await inkInstance.waitUntilExit();

    // Leave alternate screen buffer
    process.stdout.write("\x1b[?1049l");

    if (!action || action.type === "quit") {
      running = false;
      break;
    }

    if (action.type === "focus") {
      const agentProcess = pm.get(action.sessionId);

      // If agent is done/error, respawn a fresh interactive session
      if (
        !agentProcess ||
        agentProcess.status === "done" ||
        agentProcess.status === "error"
      ) {
        const session = pm.getSession(action.sessionId);
        if (session) {
          const adapter = adapters.get(session.agentName);
          if (adapter) {
            await rawPassthroughFresh(pm, adapter, "interactive");
            task = "";
            initialAgent = undefined;
            parallelAgents = undefined;
            continue;
          }
        }
        task = "";
        initialAgent = undefined;
        parallelAgents = undefined;
        continue;
      }

      // Existing running session
      await rawPassthrough(pm, action.sessionId);
    }

    if (action.type === "start_fresh") {
      const adapter = adapters.get(action.agentName);
      if (adapter) {
        await rawPassthroughFresh(pm, adapter, "interactive");
      }
    }

    // Clear initialTask so it doesn't re-spawn on re-render
    task = "";
    initialAgent = undefined;
    parallelAgents = undefined;
  }

  await pm.stopAll();
}
