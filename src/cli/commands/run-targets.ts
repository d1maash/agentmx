import chalk from "chalk";
import { Router, type RoutePlan } from "../../core/router.js";
import type { Config } from "../../config/schema.js";

export interface RunTargetOptions {
  agent?: string;
  parallel?: string;
}

export interface ResolvedRunTargets {
  initialAgent?: string;
  parallelAgents?: string[];
  reviewRoles?: {
    coder: string;
    reviewer: string;
    tester: string;
  };
  cheapFirst?: {
    firstAgent: string;
    fallbackAgent: string;
  };
  splitView: boolean;
  routePlan?: RoutePlan;
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
    if (availableAgents) {
      validateAgentNames([initialAgent], availableAgents);
    }

    return {
      initialAgent,
      splitView: false,
    };
  }

  const router = new Router(config);
  const plan = await router.routePlan(task, availableAgents);

  if (availableAgents) {
    validateAgentNames(plan.agents, availableAgents);
  }

  if (plan.strategy === "parallel") {
    return {
      parallelAgents: plan.agents,
      splitView: true,
      routePlan: plan,
    };
  }

  if (plan.strategy === "review-loop" && plan.roles) {
    return {
      reviewRoles: plan.roles,
      splitView: false,
      routePlan: plan,
    };
  }

  if (plan.strategy === "cheap-first" && plan.fallbackAgent) {
    return {
      initialAgent: plan.primaryAgent,
      cheapFirst: {
        firstAgent: plan.primaryAgent,
        fallbackAgent: plan.fallbackAgent,
      },
      splitView: false,
      routePlan: plan,
    };
  }

  return {
    initialAgent: plan.primaryAgent,
    splitView: false,
    routePlan: plan,
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
