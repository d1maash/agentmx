import React from "react";
import { render } from "ink";
import { App } from "../../tui/App.js";
import { ProcessManager } from "../../core/process-manager.js";
import { rawPassthrough, rawPassthroughFresh } from "../../tui/raw-passthrough.js";
import { createAdapters } from "../../adapters/factory.js";
import type { Config } from "../../config/schema.js";

export type TUIAction =
  | { type: "focus"; sessionId: string }
  | { type: "start_fresh"; agentName: string }
  | { type: "quit" };

export async function interactiveCommand(config: Config): Promise<void> {
  const pm = new ProcessManager();
  const adapters = createAdapters(config);

  const cleanup = async () => {
    await pm.stopAll();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  let running = true;

  while (running) {
    const actionRef: { current: TUIAction | null } = { current: null };

    const onFocus = (sessionId: string) => {
      actionRef.current = { type: "focus", sessionId };
      inkInstance.unmount();
    };

    const onStartFresh = (agentName: string) => {
      actionRef.current = { type: "start_fresh", agentName };
      inkInstance.unmount();
    };

    const onQuit = async () => {
      actionRef.current = { type: "quit" };
      await pm.stopAll();
      inkInstance.unmount();
    };

    // Enter alternate screen buffer for Ink TUI
    process.stdout.write("\x1b[?1049h");

    const inkInstance = render(
      React.createElement(App, {
        processManager: pm,
        config,
        onFocus,
        onStartFresh,
        onQuit,
      })
    );

    await inkInstance.waitUntilExit();

    // Leave alternate screen buffer
    process.stdout.write("\x1b[?1049l");

    const action = actionRef.current;

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
            continue;
          }
        }
        continue;
      }

      // Existing running session — replay buffer and enter passthrough
      await rawPassthrough(pm, action.sessionId);
    }

    if (action.type === "start_fresh") {
      // Spawn agent on clean terminal with output listener already active
      const adapter = adapters.get(action.agentName);
      if (adapter) {
        await rawPassthroughFresh(pm, adapter, "interactive");
      }
    }
  }

  await pm.stopAll();
}
