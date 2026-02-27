import type {
  AgentAdapter,
  AgentProcess,
  AgentInfo,
  SpawnOptions,
} from "./types.js";
import { execSync } from "node:child_process";
import { spawnPty } from "./pty-helpers.js";

export class AiderAdapter implements AgentAdapter {
  readonly info: AgentInfo = {
    name: "aider",
    displayName: "Aider",
    description: "Git-integrated AI coding assistant",
    command: "aider",
    isInstalled: false,
  };

  async checkInstalled(): Promise<boolean> {
    try {
      execSync("which aider", { stdio: "ignore" });
      this.info.isInstalled = true;
      return true;
    } catch {
      this.info.isInstalled = false;
      return false;
    }
  }

  spawn(task: string, options?: SpawnOptions): AgentProcess {
    return spawnPty({
      command: "aider",
      args: options?.args ?? ["--message", task],
      cwd: options?.cwd ?? process.cwd(),
      env: { ...process.env, ...options?.env } as Record<string, string>,
      agentName: "aider",
      task,
    });
  }
}
