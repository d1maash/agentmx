import type {
  AgentAdapter,
  AgentProcess,
  AgentInfo,
  SpawnOptions,
} from "./types.js";
import { execSync } from "node:child_process";
import { spawnPty } from "./pty-helpers.js";

interface CursorAdapterConfig {
  command?: string;
  defaultArgs?: string[];
  defaultEnv?: Record<string, string>;
}

export class CursorAdapter implements AgentAdapter {
  readonly info: AgentInfo;

  private config: CursorAdapterConfig;

  constructor(config?: CursorAdapterConfig) {
    this.config = config ?? {};
    const command = this.config.command ?? "cursor-agent";
    this.info = {
      name: "cursor",
      displayName: "Cursor Agent",
      description: "Cursor's CLI agent (cursor-agent)",
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
      agentName: "cursor",
      task,
    });
  }
}
