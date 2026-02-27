import type {
  AgentAdapter,
  AgentProcess,
  AgentInfo,
  SpawnOptions,
} from "./types.js";
import { execSync } from "node:child_process";
import { spawnPty } from "./pty-helpers.js";

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly info: AgentInfo = {
    name: "claude-code",
    displayName: "Claude Code",
    description: "Anthropic's AI coding agent",
    command: "claude",
    isInstalled: false,
  };

  async checkInstalled(): Promise<boolean> {
    try {
      execSync("which claude", { stdio: "ignore" });
      this.info.isInstalled = true;
      return true;
    } catch {
      this.info.isInstalled = false;
      return false;
    }
  }

  spawn(task: string, options?: SpawnOptions): AgentProcess {
    // If explicit args provided, use them
    // Otherwise: no task = interactive mode, with task = print mode
    let args: string[];
    if (options?.args) {
      args = options.args;
    } else if (task && task !== "interactive") {
      args = ["-p", task];
    } else {
      // Interactive mode: launch claude without -p
      args = [];
    }

    return spawnPty({
      command: "claude",
      args,
      cwd: options?.cwd ?? process.cwd(),
      env: { ...process.env, ...options?.env } as Record<string, string>,
      agentName: "claude-code",
      task: task || "interactive",
    });
  }
}
