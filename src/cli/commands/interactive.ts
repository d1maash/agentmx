import React from "react";
import { render } from "ink";
import { App } from "../../tui/App.js";
import { ProcessManager } from "../../core/process-manager.js";
import type { Config } from "../../config/schema.js";

export async function interactiveCommand(config: Config): Promise<void> {
  const pm = new ProcessManager();

  // Graceful shutdown
  const cleanup = async () => {
    await pm.stopAll();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  const { waitUntilExit } = render(
    React.createElement(App, {
      processManager: pm,
      config,
    })
  );

  await waitUntilExit();
  await pm.stopAll();
}
