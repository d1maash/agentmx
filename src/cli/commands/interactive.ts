import React from "react";
import { render } from "ink";
import { App } from "../../tui/App.js";
import { ProcessManager } from "../../core/process-manager.js";
import type { Config } from "../../config/schema.js";

export async function interactiveCommand(config: Config): Promise<void> {
  const pm = new ProcessManager();

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
    })
  );
  await inkInstance.waitUntilExit();
  process.stdout.write("\x1b[?1049l");

  await pm.stopAll();
}
