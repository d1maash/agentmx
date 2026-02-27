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
    // Shared action — set by App callbacks
    let action: TUIAction | null = null;

    const onFocus = (sessionId: string) => {
      action = { type: "focus", sessionId };
      // Unmount Ink to release the terminal
      inkInstance.unmount();
    };

    const onQuit = async () => {
      action = { type: "quit" };
      await pm.stopAll();
      inkInstance.unmount();
    };

    const inkInstance = render(
      React.createElement(App, {
        processManager: pm,
        config,
        onFocus,
        onQuit,
      })
    );

    await inkInstance.waitUntilExit();

    if (!action || action.type === "quit") {
      running = false;
      break;
    }

    if (action.type === "focus") {
      // Enter raw passthrough — agent gets full terminal control
      const result = await rawPassthrough(pm, action.sessionId);

      if (result === "exited") {
        // Agent finished, loop back to TUI
      }
      // "detach" — user pressed Ctrl+], loop back to TUI
    }
  }

  await pm.stopAll();
}
