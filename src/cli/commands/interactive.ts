import React from "react";
import { render } from "ink";
import { App } from "../../tui/App.js";
import { ProcessManager } from "../../core/process-manager.js";
import { rawPassthrough } from "../../tui/raw-passthrough.js";
import type { Config } from "../../config/schema.js";

export type TUIAction =
  | { type: "focus"; sessionId: string }
  | { type: "quit" };

export async function interactiveCommand(config: Config): Promise<void> {
  const pm = new ProcessManager();

  const cleanup = async () => {
    await pm.stopAll();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  let running = true;

  while (running) {
    let action: TUIAction | null = null;

    const onFocus = (sessionId: string) => {
      action = { type: "focus", sessionId };
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
        onFocus,
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
      // Raw passthrough — agent gets full terminal, no alternate buffer
      const result = await rawPassthrough(pm, action.sessionId);

      // After detach/exit, loop back to Ink TUI (which enters alt buffer)
      if (result === "exited") {
        // Agent done
      }
    }
  }

  await pm.stopAll();
}
