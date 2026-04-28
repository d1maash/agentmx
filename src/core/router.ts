import type { Config } from "../config/schema.js";
import { listSessions, type SavedSession } from "./session-store.js";
import type { ClaudeActivity } from "../adapters/types.js";

export type RouteStrategy = "single" | "parallel" | "review-loop" | "cheap-first";
export type TaskKind =
  | "test"
  | "ui"
  | "build"
  | "security"
  | "bugfix"
  | "refactor"
  | "docs"
  | "general";

export interface RouteAgentScore {
  agent: string;
  score: number;
  taskSuccessRate: number;
  overallSuccessRate: number;
  buildFailureRate: number;
  avgCost: number | undefined;
  sessions: number;
  matchingSessions: number;
}

export interface RoutePlan {
  strategy: RouteStrategy;
  taskKind: TaskKind;
  agents: string[];
  primaryAgent: string;
  fallbackAgent?: string;
  roles?: {
    coder: string;
    reviewer: string;
    tester: string;
  };
  confidence: number;
  reason: string;
  scores: RouteAgentScore[];
}

interface RouterOptions {
  sessions?: SavedSession[] | (() => SavedSession[]);
}

interface TaskProfile {
  kind: TaskKind;
  costSensitive: boolean;
  highRisk: boolean;
  complex: boolean;
}

export class Router {
  constructor(private config: Config, private options: RouterOptions = {}) {}

  /** Determine which agent to use for a task */
  async route(task: string): Promise<string> {
    const plan = await this.routePlan(task);
    return plan.primaryAgent;
  }

  /** Determine the execution strategy and agent set for a task. */
  async routePlan(
    task: string,
    availableAgents?: Iterable<string>
  ): Promise<RoutePlan> {
    const mode = this.config.router.mode;
    const agents = this.getAvailableAgents(availableAgents);

    if (mode === "manual") {
      return this.fallbackPlan(task, agents, "manual router mode");
    }

    if (mode === "rules") {
      return this.rulesPlan(task, agents);
    }

    if (mode === "auto") {
      const sessions = this.getSessions();
      const plan = this.historyPlan(task, agents, sessions);
      if (plan) {
        return plan;
      }
      return this.rulesPlan(task, agents, "not enough usable history");
    }

    return this.fallbackPlan(task, agents, "unknown router mode");
  }

  private getAvailableAgents(availableAgents?: Iterable<string>): string[] {
    const configured = Object.entries(this.config.agents)
      .filter(([, config]) => config.enabled)
      .map(([name]) => name);
    const agents = availableAgents ? Array.from(availableAgents) : configured;
    return agents.length > 0 ? agents : [this.config.default_agent];
  }

  private getSessions(): SavedSession[] {
    if (Array.isArray(this.options.sessions)) return this.options.sessions;
    if (typeof this.options.sessions === "function") return this.options.sessions();
    return listSessions();
  }

  private rulesPlan(task: string, agents: string[], reason?: string): RoutePlan {
    for (const rule of this.config.router.rules) {
      const regex = new RegExp(rule.match, "i");
      if (regex.test(task)) {
        return this.singlePlan(task, this.ensureAvailable(rule.agent, agents), {
          confidence: 0.5,
          reason: rule.reason ?? reason ?? "matched router rule",
        });
      }
    }
    return this.fallbackPlan(task, agents, reason ?? "no matching router rule");
  }

  private fallbackPlan(task: string, agents: string[], reason: string): RoutePlan {
    return this.singlePlan(task, this.ensureAvailable(this.config.default_agent, agents), {
      confidence: 0.4,
      reason,
    });
  }

  private singlePlan(
    task: string,
    agent: string,
    opts: { confidence: number; reason: string; scores?: RouteAgentScore[] }
  ): RoutePlan {
    return {
      strategy: "single",
      taskKind: classifyTask(task).kind,
      agents: [agent],
      primaryAgent: agent,
      confidence: opts.confidence,
      reason: opts.reason,
      scores: opts.scores ?? [],
    };
  }

  private ensureAvailable(agent: string, agents: string[]): string {
    return agents.includes(agent) ? agent : agents[0] ?? this.config.default_agent;
  }

  private historyPlan(
    task: string,
    agents: string[],
    sessions: SavedSession[]
  ): RoutePlan | null {
    const profile = classifyTask(task);
    const relevantSessions = sessions.filter((s) => agents.includes(s.agentName));
    const scored = scoreAgents(agents, relevantSessions, profile.kind);

    const agentsWithHistory = scored.filter((s) => s.sessions > 0).length;
    if (relevantSessions.length < 3 || agentsWithHistory === 0) {
      return null;
    }

    const [best, second] = scored;
    const cheapestReliable = scored.filter((s) => s.overallSuccessRate >= 0.45);
    const cheapest = [...cheapestReliable].sort((a, b) => {
      const aCost = a.avgCost ?? Number.POSITIVE_INFINITY;
      const bCost = b.avgCost ?? Number.POSITIVE_INFINITY;
      if (aCost !== bCost) return aCost - bCost;
      return b.score - a.score;
    })[0];
    const confidence = second ? clamp(best.score - second.score + 0.45, 0.05, 0.95) : 0.9;

    if (cheapest && profile.costSensitive) {
      const fallback = cheapest.agent === best.agent ? second : best;
      if (fallback) {
        return {
          strategy: "cheap-first",
          taskKind: profile.kind,
          agents: [cheapest.agent, fallback.agent],
          primaryAgent: cheapest.agent,
          fallbackAgent: fallback.agent,
          confidence,
          reason: `${cheapest.agent} is cheapest with acceptable history; fallback is ${fallback.agent}`,
          scores: scored,
        };
      }
    }

    if (
      cheapest &&
      cheapest.agent !== best.agent &&
      !profile.highRisk &&
      cheapest.score >= best.score * 0.82 &&
      cheapest.overallSuccessRate >= 0.45
    ) {
      return {
        strategy: "cheap-first",
        taskKind: profile.kind,
        agents: [cheapest.agent, best.agent],
        primaryAgent: cheapest.agent,
        fallbackAgent: best.agent,
        confidence,
        reason: `${cheapest.agent} is cheaper with acceptable history; fallback is ${best.agent}`,
        scores: scored,
      };
    }

    if (profile.highRisk && agents.length >= 2 && !profile.costSensitive) {
      const roles = chooseReviewRoles(scored, profile.kind);
      return {
        strategy: "review-loop",
        taskKind: profile.kind,
        agents: unique([roles.coder, roles.reviewer, roles.tester]),
        primaryAgent: roles.coder,
        roles,
        confidence,
        reason: `high-risk ${profile.kind} task; using historical strengths for coder/reviewer/tester`,
        scores: scored,
      };
    }

    const closeRace = Boolean(second && best.score - second.score < 0.12);
    if ((closeRace || profile.complex) && agents.length >= 2) {
      const parallelAgents = scored.slice(0, Math.min(3, scored.length)).map((s) => s.agent);
      return {
        strategy: "parallel",
        taskKind: profile.kind,
        agents: parallelAgents,
        primaryAgent: best.agent,
        confidence,
        reason: closeRace
          ? "top agents are statistically close"
          : "complex task benefits from parallel attempts",
        scores: scored,
      };
    }

    return {
      strategy: "single",
      taskKind: profile.kind,
      agents: [best.agent],
      primaryAgent: best.agent,
      confidence,
      reason: `${best.agent} has the best historical score for ${profile.kind} tasks`,
      scores: scored,
    };
  }
}

function classifyTask(task: string): TaskProfile {
  const text = task.toLowerCase();
  const has = (pattern: RegExp) => pattern.test(text);

  let kind: TaskKind = "general";
  if (has(/\b(test|tests|spec|coverage|jest|vitest|pytest|flaky|ci)\b|тест/)) {
    kind = "test";
  } else if (has(/\b(ui|frontend|front-end|react|vue|svelte|css|layout|style|component|responsive)\b|интерфейс|фронт|верстк/)) {
    kind = "ui";
  } else if (has(/\b(build|compile|tsc|typecheck|lint|eslint|bundle|vite|webpack)\b|сборк/)) {
    kind = "build";
  } else if (has(/\b(auth|authentication|authorization|login|password|token|oauth|security|jwt|permission)\b|авторизац|доступ/)) {
    kind = "security";
  } else if (has(/\b(refactor|cleanup|clean up|migrate|migration)\b|рефактор/)) {
    kind = "refactor";
  } else if (has(/\b(docs|documentation|readme|comment|guide)\b|документац/)) {
    kind = "docs";
  } else if (has(/\b(fix|bug|debug|crash|regression|broken)\b|чин|исправ|ошиб/)) {
    kind = "bugfix";
  }

  const costSensitive = has(/\b(cheap|cheaper|cost|budget|low cost|эконом|дешев)\b/);
  const highRisk =
    kind === "security" ||
    kind === "build" ||
    kind === "test" ||
    kind === "refactor" ||
    has(/\b(production|critical|breaking|payment|database|schema)\b|прод|критич/);
  const complex =
    task.split(/\s+/).length > 14 ||
    has(/\b(architecture|large|multi-step|end-to-end|redesign|rewrite)\b|архитектур/);

  return { kind, costSensitive, highRisk, complex };
}

function scoreAgents(
  agents: string[],
  sessions: SavedSession[],
  taskKind: TaskKind
): RouteAgentScore[] {
  const byAgent = new Map<string, SavedSession[]>();
  for (const agent of agents) byAgent.set(agent, []);
  for (const session of sessions) {
    byAgent.get(session.agentName)?.push(session);
  }

  const raw = agents.map((agent) => {
    const agentSessions = byAgent.get(agent) ?? [];
    const matching = agentSessions.filter((s) => classifyTask(s.task).kind === taskKind);
    const buildSessions = agentSessions.filter((s) => classifyTask(s.task).kind === "build");
    const costs = agentSessions
      .map(extractSessionCost)
      .filter((cost): cost is number => cost !== undefined && cost > 0);

    const successCount = agentSessions.filter((s) => s.status === "done").length;
    const matchingSuccessCount = matching.filter((s) => s.status === "done").length;
    const buildFailureCount = buildSessions.filter((s) => s.status === "error").length;
    const avgCost = costs.length > 0 ? costs.reduce((sum, cost) => sum + cost, 0) / costs.length : undefined;

    return {
      agent,
      sessions: agentSessions.length,
      matchingSessions: matching.length,
      taskSuccessRate: bayesRate(matchingSuccessCount, matching.length),
      overallSuccessRate: bayesRate(successCount, agentSessions.length),
      buildFailureRate: buildSessions.length > 0 ? buildFailureCount / buildSessions.length : 0,
      avgCost,
    };
  });

  const finiteCosts = raw
    .map((s) => s.avgCost)
    .filter((cost): cost is number => cost !== undefined);
  const minCost = finiteCosts.length > 0 ? Math.min(...finiteCosts) : 0;
  const maxCost = finiteCosts.length > 0 ? Math.max(...finiteCosts) : 0;

  return raw
    .map((s) => {
      const costScore =
        s.avgCost === undefined || minCost === maxCost
          ? 0.5
          : 1 - (s.avgCost - minCost) / (maxCost - minCost);
      const evidenceAdjustment = s.matchingSessions > 0 ? 0.12 : -0.05;
      const buildPenalty = s.buildFailureRate * 0.15;
      const score = clamp(
        s.taskSuccessRate * 0.45 +
          s.overallSuccessRate * 0.35 +
          costScore * 0.2 -
          buildPenalty +
          evidenceAdjustment,
        0,
        1
      );
      return { ...s, score };
    })
    .sort((a, b) => b.score - a.score);
}

function chooseReviewRoles(
  scores: RouteAgentScore[],
  taskKind: TaskKind
): { coder: string; reviewer: string; tester: string } {
  const coder = scores[0].agent;
  const reviewer =
    scores.find((s) => s.agent !== coder && s.buildFailureRate <= scores[0].buildFailureRate)?.agent ??
    scores.find((s) => s.agent !== coder)?.agent ??
    coder;
  const tester =
    scores
      .filter((s) => s.agent !== coder && s.agent !== reviewer)
      .sort((a, b) => b.taskSuccessRate - a.taskSuccessRate)[0]?.agent ??
    scores.find((s) => s.agent !== coder)?.agent ??
    coder;

  if (taskKind === "test") {
    return { coder: scores[0].agent, reviewer, tester: scores[0].agent };
  }
  return { coder, reviewer, tester };
}

function extractSessionCost(session: SavedSession): number | undefined {
  let cost: number | undefined;
  for (const entry of session.buffer) {
    if (entry.activity?.kind === "cost") {
      const act = entry.activity as Extract<ClaudeActivity, { kind: "cost" }>;
      cost = Math.max(cost ?? 0, act.totalCost);
    }
  }
  return cost;
}

function bayesRate(successes: number, total: number): number {
  return (successes + 1) / (total + 2);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
