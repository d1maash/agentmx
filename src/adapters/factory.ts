import type { AgentAdapter } from "./types.js";
import type { Config } from "../config/schema.js";
import { ClaudeCodeAdapter } from "./claude-code.js";
import { CodexAdapter } from "./codex.js";
import { AiderAdapter } from "./aider.js";
import { CustomAdapter } from "./custom.js";

/**
 * Create adapter instances from config.
 * Shared between TUI hooks and CLI commands.
 */
export function createAdapters(config: Config): Map<string, AgentAdapter> {
  const adapters = new Map<string, AgentAdapter>();

  for (const [name, agentConfig] of Object.entries(config.agents)) {
    if (!agentConfig.enabled) continue;

    let adapter: AgentAdapter;
    switch (name) {
      case "claude-code":
        adapter = new ClaudeCodeAdapter();
        break;
      case "codex":
        adapter = new CodexAdapter();
        break;
      case "aider":
        adapter = new AiderAdapter();
        break;
      default:
        adapter = new CustomAdapter({
          name,
          command: agentConfig.command,
          defaultArgs: agentConfig.args,
          env: agentConfig.env,
        });
    }
    adapters.set(name, adapter);
  }

  return adapters;
}
