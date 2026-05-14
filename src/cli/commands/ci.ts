import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import chalk from "chalk";
import { createAdapters } from "../../adapters/factory.js";
import { ProcessManager } from "../../core/process-manager.js";
import {
  escalateUntilPass,
  raceUntilPass,
  type OptimizerOutcome,
  type OptimizerTier,
} from "../../core/optimizer.js";
import { VotingSession, type VotingStrategy, type VotingResult } from "../../core/voting.js";
import { verifySolution } from "../../core/verifier.js";
import type { Config } from "../../config/schema.js";

/**
 * Deterministic exit codes for `amx ci`. These are the contract consumers
 * (GitHub Actions, Jenkins, internal CI) script against — do not reorder
 * without a major version bump.
 */
export const CI_EXIT = {
  OK: 0,
  FAILURE: 1,
  BUDGET: 2,
  TIMEOUT: 3,
  USAGE: 4,
} as const;
export type CiExit = (typeof CI_EXIT)[keyof typeof CI_EXIT];

export interface CiCommonOptions {
  /** Path to write the JSON report. When omitted, the report goes to stdout. */
  report?: string;
  /** Emit NDJSON event lines to stderr while the run is in flight. */
  jsonEvents?: boolean;
  /** Hard cost cap (USD) for the whole run. */
  maxCost?: string;
  /** Wall-clock timeout in seconds. Mapped to exit code 3 when hit. */
  timeout?: string;
}

function bootstrapCi(): void {
  // Force colors off so logs are diff-friendly in CI consoles.
  chalk.level = 0;
  process.env.AGENTMX_CI = "1";
}

/**
 * Sentinel used to short-circuit a ci command after we've already written the
 * report. The outer try/catch re-raises this through process.exit instead of
 * misinterpreting it as an unexpected runtime error and writing a second
 * report on top of the real one.
 */
class CiExitSignal extends Error {
  constructor(public readonly code: CiExit) {
    super(`__amx_ci_exit_${code}`);
  }
}

function exitWith(code: CiExit): never {
  throw new CiExitSignal(code);
}

function parseMaxCost(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`--max-cost must be a positive number; got "${raw}"`);
  }
  return n;
}

function parseTimeoutMs(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`--timeout must be a positive number; got "${raw}"`);
  }
  return Math.round(n * 1000);
}

function writeReport(report: Record<string, unknown>, opts: CiCommonOptions): void {
  const payload = JSON.stringify(report, null, 2);
  if (opts.report) {
    const path = resolve(process.cwd(), opts.report);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, payload);
    process.stderr.write(`amx ci: report written to ${path}\n`);
  } else {
    process.stdout.write(payload + "\n");
  }
}

function emitEvent(opts: CiCommonOptions, kind: string, payload: Record<string, unknown>): void {
  if (!opts.jsonEvents) return;
  process.stderr.write(JSON.stringify({ ts: Date.now(), kind, ...payload }) + "\n");
}

async function withTimeout<T>(
  p: Promise<T>,
  timeoutMs: number | undefined,
  onTimeout: () => Promise<void>
): Promise<{ value?: T; timedOut: boolean }> {
  if (!timeoutMs) return { value: await p, timedOut: false };
  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;
  const timeout = new Promise<{ value?: T; timedOut: boolean }>((resolve_) => {
    timer = setTimeout(async () => {
      timedOut = true;
      await onTimeout().catch(() => undefined);
      resolve_({ timedOut: true });
    }, timeoutMs);
  });
  const winner = await Promise.race([
    p.then((value) => ({ value, timedOut: false })),
    timeout,
  ]);
  if (timer) clearTimeout(timer);
  return winner;
}

// ────────────────────────────────────────────────────────────────────────────
// amx ci run <task>
// ────────────────────────────────────────────────────────────────────────────

export interface CiRunOptions extends CiCommonOptions {
  agent?: string;
}

export async function ciRunCommand(
  task: string,
  options: CiRunOptions,
  config: Config
): Promise<void> {
  bootstrapCi();
  try {
    const maxCost = parseMaxCost(options.maxCost) ?? config.budgets.hard_stop_per_run;
    const timeoutMs = parseTimeoutMs(options.timeout);
    const adapters = createAdapters(config);
    const agentName = options.agent && options.agent !== "auto"
      ? options.agent
      : adapters.has("claude-code")
        ? "claude-code"
        : adapters.keys().next().value;

    const adapter = agentName ? adapters.get(agentName) : undefined;
    if (!adapter) {
      writeReport(
        {
          command: "ci run",
          ok: false,
          reason: "no usable agent",
          available: [...adapters.keys()],
        },
        options
      );
      process.exit(CI_EXIT.USAGE);
    }

    const pm = new ProcessManager(process.cwd());
    let budgetBreach: { cost: number; cap: number } | undefined;
    pm.on("budget:hardstop", (info: { cost: number; cap: number }) => {
      budgetBreach = info;
      emitEvent(options, "budget.hardstop", info);
    });

    emitEvent(options, "run.start", { agent: adapter.info.name, task });
    const started = Date.now();
    const sessionId = await pm.start(adapter, task, { maxCostUsd: maxCost });
    const proc = pm.get(sessionId)!;

    (async () => {
      for await (const chunk of proc.output) {
        process.stdout.write(chunk.data);
      }
    })().catch(() => undefined);

    const { value, timedOut } = await withTimeout(
      proc.done,
      timeoutMs,
      () => pm.stop(sessionId).catch(() => undefined) as Promise<void>
    );
    const exitCode = value?.exitCode ?? -1;
    const durationMs = Date.now() - started;

    const report = {
      command: "ci run",
      ok: !timedOut && !budgetBreach && exitCode === 0,
      agent: adapter.info.name,
      task,
      exitCode,
      durationMs,
      timedOut,
      budgetBreach,
    };
    writeReport(report, options);
    emitEvent(options, "run.end", report);

    if (timedOut) process.exit(CI_EXIT.TIMEOUT);
    if (budgetBreach) process.exit(CI_EXIT.BUDGET);
    process.exit(exitCode === 0 ? CI_EXIT.OK : CI_EXIT.FAILURE);
  } catch (err) {
    writeReport(
      { command: "ci run", ok: false, error: err instanceof Error ? err.message : String(err) },
      options
    );
    process.exit(CI_EXIT.USAGE);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// amx ci solve <task>
// ────────────────────────────────────────────────────────────────────────────

export interface CiSolveOptions extends CiCommonOptions {
  agent?: string;
}

export async function ciSolveCommand(
  task: string,
  options: CiSolveOptions,
  config: Config
): Promise<void> {
  bootstrapCi();
  try {
    const maxCost = parseMaxCost(options.maxCost) ?? config.budgets.hard_stop_per_run;
    const timeoutMs = parseTimeoutMs(options.timeout);
    const adapters = createAdapters(config);
    const agentName = options.agent && options.agent !== "auto"
      ? options.agent
      : adapters.has("claude-code")
        ? "claude-code"
        : adapters.keys().next().value;
    const adapter = agentName ? adapters.get(agentName) : undefined;
    if (!adapter) {
      writeReport({ command: "ci solve", ok: false, reason: "no usable agent" }, options);
      process.exit(CI_EXIT.USAGE);
    }

    const cwd = process.cwd();
    const pm = new ProcessManager(cwd);
    let budgetBreach: { cost: number; cap: number } | undefined;
    pm.on("budget:hardstop", (info: { cost: number; cap: number }) => {
      budgetBreach = info;
    });

    emitEvent(options, "solve.start", { agent: adapter.info.name });
    const started = Date.now();
    const sessionId = await pm.start(adapter, task, { cwd, maxCostUsd: maxCost });
    const proc = pm.get(sessionId)!;
    (async () => {
      for await (const chunk of proc.output) {
        process.stdout.write(chunk.data);
      }
    })().catch(() => undefined);

    const { timedOut } = await withTimeout(
      proc.done,
      timeoutMs,
      () => pm.stop(sessionId).catch(() => undefined) as Promise<void>
    );

    const proof = verifySolution({ cwd, task });
    const durationMs = Date.now() - started;

    const ok = !timedOut && !budgetBreach && proof.verdict === "pass";
    const report = {
      command: "ci solve",
      ok,
      agent: adapter.info.name,
      task,
      durationMs,
      timedOut,
      budgetBreach,
      verdict: proof.verdict,
      score: proof.overallScore,
      checks: proof.checks.map((c) => ({
        name: c.name,
        status: c.status,
        score: c.score,
        summary: c.summary,
      })),
      diff: proof.diffStats,
    };
    writeReport(report, options);
    emitEvent(options, "solve.end", { ok, verdict: proof.verdict });

    if (timedOut) process.exit(CI_EXIT.TIMEOUT);
    if (budgetBreach) process.exit(CI_EXIT.BUDGET);
    process.exit(ok ? CI_EXIT.OK : CI_EXIT.FAILURE);
  } catch (err) {
    writeReport(
      { command: "ci solve", ok: false, error: err instanceof Error ? err.message : String(err) },
      options
    );
    process.exit(CI_EXIT.USAGE);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// amx ci optimize <task>
// ────────────────────────────────────────────────────────────────────────────

export interface CiOptimizeOptions extends CiCommonOptions {
  tiers?: string;
  race?: boolean;
  isolate?: boolean;
  keepWorktrees?: boolean;
  testsOnly?: boolean;
}

export async function ciOptimizeCommand(
  task: string,
  options: CiOptimizeOptions,
  config: Config
): Promise<void> {
  bootstrapCi();
  try {
    const adapters = createAdapters(config);
    const maxCost = parseMaxCost(options.maxCost) ?? config.budgets.hard_stop_per_run;
    const timeoutMs = parseTimeoutMs(options.timeout);
    const tiers: OptimizerTier[] = options.tiers
      ? options.tiers
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .filter((a) => adapters.has(a))
          .map((agent, i, all) => ({
            agent,
            label: i === 0 ? "cheap" : i === all.length - 1 ? "expensive" : `tier-${i + 1}`,
          }))
      : ["codex", "claude-code"]
          .filter((a) => adapters.has(a))
          .map((agent, i, all) => ({
            agent,
            label: i === 0 ? "cheap" : i === all.length - 1 ? "expensive" : `tier-${i + 1}`,
          }));

    if (tiers.length === 0) {
      writeReport({ command: "ci optimize", ok: false, reason: "no usable tiers" }, options);
      process.exit(CI_EXIT.USAGE);
    }

    const pm = new ProcessManager(process.cwd());
    const runner = options.race ? raceUntilPass : escalateUntilPass;
    const started = Date.now();
    let timedOut = false;

    const outcomePromise: Promise<OptimizerOutcome> = runner(task, tiers, pm, adapters, {
      cwd: process.cwd(),
      isolate: options.isolate ?? config.parallel.isolate,
      keepWorktrees: options.keepWorktrees,
      maxCostPerTierUsd: maxCost,
      verifyOverrides: options.testsOnly
        ? { runLint: false, runTypecheck: false }
        : undefined,
      onTierStart: (tier, i) =>
        emitEvent(options, "tier.start", { index: i, agent: tier.agent }),
      onTierEnd: (r) =>
        emitEvent(options, "tier.end", {
          agent: r.tier.agent,
          verdict: r.verdict,
          cost: r.cost,
          durationMs: r.durationMs,
          hardStopped: r.hardStopped,
        }),
    });

    const { value: outcome } = await withTimeout(
      outcomePromise,
      timeoutMs,
      async () => {
        timedOut = true;
        await pm.stopAll().catch(() => undefined);
      }
    );

    const durationMs = Date.now() - started;
    const ok = !timedOut && Boolean(outcome?.success);
    const anyHardStop = outcome?.attempts.some((a) => a.hardStopped) ?? false;

    const report = {
      command: "ci optimize",
      ok,
      mode: options.race ? "race" : "escalate",
      task,
      durationMs,
      timedOut,
      anyHardStop,
      totalCost: outcome?.totalCost ?? 0,
      winner: outcome?.winner
        ? { agent: outcome.winner.tier.agent, cost: outcome.winner.cost }
        : null,
      attempts: outcome?.attempts.map((a) => ({
        agent: a.tier.agent,
        verdict: a.verdict,
        cost: a.cost,
        durationMs: a.durationMs,
        hardStopped: a.hardStopped,
        abortedReason: a.abortedReason,
      })),
    };
    writeReport(report, options);

    if (timedOut) process.exit(CI_EXIT.TIMEOUT);
    if (!ok && anyHardStop && !outcome?.success) process.exit(CI_EXIT.BUDGET);
    process.exit(ok ? CI_EXIT.OK : CI_EXIT.FAILURE);
  } catch (err) {
    writeReport(
      { command: "ci optimize", ok: false, error: err instanceof Error ? err.message : String(err) },
      options
    );
    process.exit(CI_EXIT.USAGE);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// amx ci vote <task>
// ────────────────────────────────────────────────────────────────────────────

export interface CiVoteOptions extends CiCommonOptions {
  agents?: string;
  judge?: string;
  strategy?: string;
  isolate?: boolean;
  applyWinner?: boolean;
}

export async function ciVoteCommand(
  task: string,
  options: CiVoteOptions,
  config: Config
): Promise<void> {
  bootstrapCi();
  try {
    const adapters = createAdapters(config);
    const maxCost = parseMaxCost(options.maxCost) ?? config.budgets.hard_stop_per_run;
    const timeoutMs = parseTimeoutMs(options.timeout);

    const agentNames = options.agents
      ? options.agents.split(",").map((s) => s.trim())
      : Array.from(adapters.keys());
    for (const name of agentNames) {
      if (!adapters.has(name)) {
        writeReport(
          { command: "ci vote", ok: false, reason: `unknown agent "${name}"` },
          options
        );
        process.exit(CI_EXIT.USAGE);
      }
    }
    if (agentNames.length < 2) {
      writeReport({ command: "ci vote", ok: false, reason: "need ≥ 2 agents" }, options);
      process.exit(CI_EXIT.USAGE);
    }
    const judge = options.judge ?? agentNames[0];
    const strategy = (options.strategy ?? "best") as VotingStrategy;

    const pm = new ProcessManager(process.cwd());
    const session = new VotingSession(agentNames, judge, strategy, pm, adapters);
    const started = Date.now();

    const runPromise = (async (): Promise<VotingResult | undefined> => {
      let final: VotingResult | undefined;
      for await (const event of session.execute(task, {
        isolate: options.isolate ?? config.parallel.isolate,
        cwd: process.cwd(),
        applyWinner: options.applyWinner,
        maxCostPerCandidateUsd: maxCost,
      })) {
        if (event.phase === "collecting" && event.candidateComplete) {
          emitEvent(options, "candidate.complete", {
            agent: event.candidateComplete.agent,
            exitCode: event.candidateComplete.exitCode,
            cost: event.candidateComplete.cost,
          });
        }
        if (event.phase === "done") final = event.result;
      }
      return final;
    })();

    let timedOut = false;
    const { value: result } = await withTimeout(runPromise, timeoutMs, async () => {
      timedOut = true;
      await pm.stopAll().catch(() => undefined);
    });

    const durationMs = Date.now() - started;
    const ok = !timedOut && Boolean(result?.winnerAgent);
    const report = {
      command: "ci vote",
      ok,
      task,
      durationMs,
      timedOut,
      strategy,
      winner: result?.winnerAgent ?? null,
      winnerApplied: result?.winnerApplied ?? false,
      candidates: result?.candidates.map((c) => ({
        agent: c.agent,
        exitCode: c.exitCode,
        cost: c.cost,
        durationMs: c.durationMs,
        outputBytes: c.output.length,
      })),
    };
    writeReport(report, options);
    if (timedOut) process.exit(CI_EXIT.TIMEOUT);
    process.exit(ok ? CI_EXIT.OK : CI_EXIT.FAILURE);
  } catch (err) {
    writeReport(
      { command: "ci vote", ok: false, error: err instanceof Error ? err.message : String(err) },
      options
    );
    process.exit(CI_EXIT.USAGE);
  }
}

