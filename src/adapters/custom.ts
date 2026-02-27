import type {
  AgentAdapter,
  AgentProcess,
  AgentInfo,
  SpawnOptions,
} from "./types.js";
import { execSync } from "node:child_process";
import { spawnPty } from "./pty-helpers.js";

export interface CustomAgentConfig {
  name: string;
  displayName?: string;
  command: string;
  defaultArgs?: string[];
  env?: Record<string, string>;
}

export class CustomAdapter implements AgentAdapter {
  readonly info: AgentInfo;
  private config: CustomAgentConfig;

  constructor(config: CustomAgentConfig) {
    this.config = config;
    this.info = {
      name: config.name,
      displayName: config.displayName ?? config.name,
      description: `Custom agent: ${config.command}`,
      command: config.command,
      isInstalled: false,
    };
  }

  async checkInstalled(): Promise<boolean> {
    try {
      execSync(`which ${this.config.command}`, { stdio: "ignore" });
      this.info.isInstalled = true;
      return true;
    } catch {
      this.info.isInstalled = false;
      return false;
    }
  }

  spawn(task: string, options?: SpawnOptions): AgentProcess {
    return spawnPty({
      command: this.config.command,
      args: options?.args ?? [...(this.config.defaultArgs ?? []), task],
      cwd: options?.cwd ?? process.cwd(),
      env: {
        ...process.env,
        ...this.config.env,
        ...options?.env,
      } as Record<string, string>,
      agentName: this.config.name,
      task,
    });
  }
}
