import type {
  AgentAdapter,
  AgentProcess,
  AgentInfo,
  SpawnOptions,
} from "./types.js";
import { execSync } from "node:child_process";
import { spawnPty } from "./pty-helpers.js";

export class CodexAdapter implements AgentAdapter {
  readonly info: AgentInfo = {
    name: "codex",
    displayName: "Codex CLI",
    description: "OpenAI's coding agent",
    command: "codex",
    isInstalled: false,
  };

  async checkInstalled(): Promise<boolean> {
    try {
      execSync("which codex", { stdio: "ignore" });
      this.info.isInstalled = true;
      return true;
    } catch {
      this.info.isInstalled = false;
      return false;
    }
  }

  spawn(task: string, options?: SpawnOptions): AgentProcess {
    let args: string[];
    if (options?.args) {
      args = options.args;
    } else if (task && task !== "interactive") {
      args = [task];
    } else {
      args = [];
    }

    return spawnPty({
      command: "codex",
      args,
      cwd: options?.cwd ?? process.cwd(),
      env: { ...process.env, ...options?.env } as Record<string, string>,
      agentName: "codex",
      task: task || "interactive",
    });
  }
}
