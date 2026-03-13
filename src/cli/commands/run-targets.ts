import chalk from "chalk";
import { Router } from "../../core/router.js";
import type { Config } from "../../config/schema.js";

export interface RunTargetOptions {
  agent?: string;
  parallel?: string;
}

export interface ResolvedRunTargets {
  initialAgent?: string;
  parallelAgents?: string[];
  splitView: boolean;
}

export function parseAgentList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function validateAgentNames(
  agentNames: string[],
  availableAgents: Iterable<string>
): void {
  const available = new Set(availableAgents);
  for (const agentName of agentNames) {
    if (!available.has(agentName)) {
      throw new Error(`Unknown or disabled agent: ${agentName}`);
    }
  }
}

export async function resolveRunTargets(
  task: string,
  options: RunTargetOptions,
  config: Config,
  availableAgents?: Iterable<string>
): Promise<ResolvedRunTargets> {
  if (options.parallel) {
    const parallelAgents = parseAgentList(options.parallel);
    if (parallelAgents.length === 0) {
      throw new Error("Parallel mode requires at least one agent.");
    }

    if (availableAgents) {
      validateAgentNames(parallelAgents, availableAgents);
    }

    return {
      parallelAgents,
      splitView: true,
    };
  }

  let initialAgent: string;
  if (options.agent && options.agent !== "auto") {
    initialAgent = options.agent;
  } else {
    const router = new Router(config);
    initialAgent = await router.route(task);
  }

  if (availableAgents) {
    validateAgentNames([initialAgent], availableAgents);
  }

  return {
    initialAgent,
    splitView: false,
  };
}

export function printRunTargetError(
  err: unknown,
  availableAgents: Iterable<string>
): void {
  const message = err instanceof Error ? err.message : String(err);
  const available = Array.from(availableAgents);

  console.error(chalk.red(message));
  if (available.length > 0) {
    console.error(chalk.dim(`Available agents: ${available.join(", ")}`));
  }
}
