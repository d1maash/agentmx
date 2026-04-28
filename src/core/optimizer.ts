import type { AgentAdapter, AgentProcess, ClaudeActivity } from "../adapters/types.js";
import { ProcessManager } from "./process-manager.js";
import { verifySolution, type VerificationProof } from "./verifier.js";

export interface OptimizerTier {
  /** Adapter name to invoke */
  agent: string;
  /** Optional human label for logs ("cheap", "expensive"). */
  label?: string;
  /** Hard time cap before we abandon this tier and move on. */
  timeoutMs?: number;
}

export interface OptimizerOptions {
  /** Working directory for verification (defaults to process.cwd()). */
  cwd?: string;
  /** Stream chunks back to caller for live UI. */
  onOutput?: (tier: OptimizerTier, chunk: string) => void;
  /** Notified when a tier starts. */
  onTierStart?: (tier: OptimizerTier, index: number) => void;
  /** Notified when a tier completes (with verdict). */
  onTierEnd?: (result: TierResult) => void;
  /** Disable verification — fall back to exit-code-only success detection. */
  skipVerify?: boolean;
  /** Override verification options (timeouts, which checks to run). */
  verifyOverrides?: {
    runTests?: boolean;
    runLint?: boolean;
    runTypecheck?: boolean;
    timeoutMs?: number;
  };
}

export interface TierResult {
  tier: OptimizerTier;
  index: number;
  exitCode: number;
  cost: number;
  durationMs: number;
  verdict: "pass" | "fail";
  proof?: VerificationProof;
  /** Reason a tier was skipped or aborted ("timeout", "cancelled", etc.) */
  abortedReason?: string;
}

export interface OptimizerOutcome {
  /** Final tier that produced the passing result, if any. */
  winner?: TierResult;
  /** Per-tier results in execution order. */
  attempts: TierResult[];
  /** Sum of cost across every attempt. */
  totalCost: number;
  /** True when at least one tier produced a passing verdict. */
  success: boolean;
}

/**
 * Cheap-first cost optimizer.
 *
 * Runs the cheapest tier first. After it finishes, runs verification
 * (tests / typecheck / lint via the existing verifier). Only if the
 * verdict is "fail" does the next, more expensive tier kick in.
 *
 * The "cost of a successful PR" is `outcome.totalCost` — every dollar
 * we burned on cheap attempts before the winner counts toward it.
 */
export async function escalateUntilPass(
  task: string,
  tiers: OptimizerTier[],
  pm: ProcessManager,
  adapters: Map<string, AgentAdapter>,
  options: OptimizerOptions = {}
): Promise<OptimizerOutcome> {
  if (tiers.length === 0) {
    throw new Error("escalateUntilPass: at least one tier is required");
  }
  const cwd = options.cwd ?? process.cwd();
  const attempts: TierResult[] = [];

  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i];
    const adapter = adapters.get(tier.agent);
    if (!adapter) {
      attempts.push({
        tier,
        index: i,
        exitCode: -1,
        cost: 0,
        durationMs: 0,
        verdict: "fail",
        abortedReason: `adapter "${tier.agent}" not available`,
      });
      continue;
    }

    options.onTierStart?.(tier, i);

    const started = Date.now();
    const sessionId = await pm.start(adapter, task);
    const proc = pm.get(sessionId);
    if (!proc) {
      attempts.push({
        tier,
        index: i,
        exitCode: -1,
        cost: 0,
        durationMs: 0,
        verdict: "fail",
        abortedReason: "failed to spawn",
      });
      continue;
    }

    const stream = streamOutput(proc, (chunk) => options.onOutput?.(tier, chunk));
    const timed = withTimeout(proc.done, tier.timeoutMs);

    let exitCode = -1;
    let abortedReason: string | undefined;
    try {
      const result = await timed;
      exitCode = result.exitCode;
    } catch (err) {
      abortedReason = err instanceof Error ? err.message : String(err);
      await pm.stop(sessionId).catch(() => undefined);
    }
    await stream.catch(() => undefined);

    const cost = extractCost(proc);
    const durationMs = Date.now() - started;

    let verdict: "pass" | "fail" = exitCode === 0 ? "pass" : "fail";
    let proof: VerificationProof | undefined;

    if (!abortedReason && !options.skipVerify) {
      proof = verifySolution({
        cwd,
        task,
        runTests: options.verifyOverrides?.runTests,
        runLint: options.verifyOverrides?.runLint,
        runTypecheck: options.verifyOverrides?.runTypecheck,
        timeoutMs: options.verifyOverrides?.timeoutMs,
      });
      verdict = proof.verdict;
    }

    const result: TierResult = {
      tier,
      index: i,
      exitCode,
      cost,
      durationMs,
      verdict,
      proof,
      abortedReason,
    };
    attempts.push(result);
    options.onTierEnd?.(result);

    if (verdict === "pass") {
      return finalize(attempts, result);
    }
  }

  return finalize(attempts, undefined);
}

/**
 * Race orchestrator. Spawns every agent at once. The first agent whose
 * exit code is 0 (and, when verification is enabled, whose patch passes
 * verification) wins; the others are killed immediately. The outcome
 * includes the cost of *every* agent, so it accurately reflects the
 * money burned to obtain that passing PR.
 */
export async function raceUntilPass(
  task: string,
  tiers: OptimizerTier[],
  pm: ProcessManager,
  adapters: Map<string, AgentAdapter>,
  options: OptimizerOptions = {}
): Promise<OptimizerOutcome> {
  if (tiers.length === 0) {
    throw new Error("raceUntilPass: at least one tier is required");
  }
  const cwd = options.cwd ?? process.cwd();

  type Runner = {
    tier: OptimizerTier;
    index: number;
    sessionId?: string;
    proc?: AgentProcess;
    started: number;
    streamPromise?: Promise<void>;
    finished?: TierResult;
  };

  const runners: Runner[] = tiers.map((tier, index) => ({
    tier,
    index,
    started: Date.now(),
  }));

  // Spawn all in parallel.
  for (const r of runners) {
    const adapter = adapters.get(r.tier.agent);
    if (!adapter) {
      r.finished = {
        tier: r.tier,
        index: r.index,
        exitCode: -1,
        cost: 0,
        durationMs: 0,
        verdict: "fail",
        abortedReason: `adapter "${r.tier.agent}" not available`,
      };
      continue;
    }
    options.onTierStart?.(r.tier, r.index);
    r.sessionId = await pm.start(adapter, task);
    r.proc = pm.get(r.sessionId);
    if (r.proc) {
      r.streamPromise = streamOutput(r.proc, (chunk) =>
        options.onOutput?.(r.tier, chunk)
      );
    }
  }

  let winner: TierResult | undefined;

  // Wait for the first runner whose exit + verify yields "pass".
  // We resolve as soon as a candidate passes verification, then kill the rest.
  while (winner === undefined) {
    const pending = runners.filter((r) => r.proc && !r.finished);
    if (pending.length === 0) break;

    const racers = pending.map((r) =>
      withTimeout(r.proc!.done, r.tier.timeoutMs)
        .then((res) => ({ runner: r, exitCode: res.exitCode }))
        .catch((err: unknown) => ({
          runner: r,
          exitCode: -1,
          abortedReason: err instanceof Error ? err.message : String(err),
        }))
    );

    const finished = await Promise.race(racers);
    const r = finished.runner;
    const cost = r.proc ? extractCost(r.proc) : 0;
    const durationMs = Date.now() - r.started;
    let verdict: "pass" | "fail" = finished.exitCode === 0 ? "pass" : "fail";
    let proof: VerificationProof | undefined;

    if (
      !("abortedReason" in finished && finished.abortedReason) &&
      !options.skipVerify &&
      finished.exitCode === 0
    ) {
      proof = verifySolution({
        cwd,
        task,
        runTests: options.verifyOverrides?.runTests,
        runLint: options.verifyOverrides?.runLint,
        runTypecheck: options.verifyOverrides?.runTypecheck,
        timeoutMs: options.verifyOverrides?.timeoutMs,
      });
      verdict = proof.verdict;
    }

    r.finished = {
      tier: r.tier,
      index: r.index,
      exitCode: finished.exitCode,
      cost,
      durationMs,
      verdict,
      proof,
      abortedReason: "abortedReason" in finished ? finished.abortedReason : undefined,
    };
    options.onTierEnd?.(r.finished);

    if (verdict === "pass") {
      winner = r.finished;
      // Kill everyone else.
      const others = runners.filter(
        (other) => other !== r && other.sessionId && !other.finished
      );
      await Promise.allSettled(
        others.map(async (other) => {
          await pm.stop(other.sessionId!).catch(() => undefined);
          const cancelCost = other.proc ? extractCost(other.proc) : 0;
          other.finished = {
            tier: other.tier,
            index: other.index,
            exitCode: -1,
            cost: cancelCost,
            durationMs: Date.now() - other.started,
            verdict: "fail",
            abortedReason: "cancelled — sibling won the race",
          };
          options.onTierEnd?.(other.finished);
        })
      );
      break;
    }
  }

  // Drain any remaining streams (best-effort).
  await Promise.allSettled(
    runners.map((r) => r.streamPromise ?? Promise.resolve())
  );

  const attempts = runners
    .map((r) => r.finished)
    .filter((r): r is TierResult => Boolean(r))
    .sort((a, b) => a.index - b.index);

  return finalize(attempts, winner);
}

function finalize(
  attempts: TierResult[],
  winner: TierResult | undefined
): OptimizerOutcome {
  const totalCost = attempts.reduce((sum, a) => sum + a.cost, 0);
  return {
    winner,
    attempts,
    totalCost,
    success: Boolean(winner),
  };
}

async function streamOutput(
  proc: AgentProcess,
  onChunk?: (chunk: string) => void
): Promise<void> {
  for await (const chunk of proc.output) {
    onChunk?.(chunk.data);
  }
}

function withTimeout<T>(p: Promise<T>, timeoutMs?: number): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return p;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
    p.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/** Pull the maximum totalCost reported by the agent's cost activity events. */
export function extractCost(proc: AgentProcess): number {
  let cost = 0;
  for (const entry of proc.buffer) {
    if (entry.activity?.kind === "cost") {
      const act = entry.activity as Extract<ClaudeActivity, { kind: "cost" }>;
      if (act.totalCost > cost) cost = act.totalCost;
    }
  }
  return cost;
}
