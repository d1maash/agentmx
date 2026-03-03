import type {
  AgentAdapter,
  AgentProcess,
  AgentInfo,
  SpawnOptions,
} from "./types.js";
import { execSync } from "node:child_process";
import { spawnPty } from "./pty-helpers.js";

interface GeminiAdapterConfig {
  command?: string;
  defaultArgs?: string[];
  defaultEnv?: Record<string, string>;
}

export class GeminiAdapter implements AgentAdapter {
  readonly info: AgentInfo;

  private config: GeminiAdapterConfig;

  constructor(config?: GeminiAdapterConfig) {
    this.config = config ?? {};
    const command = this.config.command ?? "gemini";
    this.info = {
      name: "gemini",
      displayName: "Gemini CLI",
      description: "Google's Gemini coding agent CLI",
      command,
      isInstalled: false,
    };
  }

  async checkInstalled(): Promise<boolean> {
    try {
      execSync(`which ${this.info.command}`, { stdio: "ignore" });
      this.info.isInstalled = true;
      return true;
    } catch {
      this.info.isInstalled = false;
      return false;
    }
  }

  spawn(task: string, options?: SpawnOptions): AgentProcess {
    const isInteractive = task.trim().toLowerCase() === "interactive";
    const modeArgs = isInteractive ? [] : ["-p", task];

    return spawnPty({
      command: this.info.command,
      args: options?.args ?? [...(this.config.defaultArgs ?? []), ...modeArgs],
      cwd: options?.cwd ?? process.cwd(),
      env: {
        ...process.env,
        ...this.config.defaultEnv,
        ...options?.env,
      } as Record<string, string>,
      agentName: "gemini",
      task,
    });
  }
}
