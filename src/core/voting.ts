import { EventEmitter } from "node:events";
import type { AgentAdapter, AgentOutput } from "../adapters/types.js";
import type { ProcessManager } from "./process-manager.js";
import {
  allocateWorktree,
  applyWorktreeDiff,
  type AllocatedWorktree,
} from "./worktree.js";

export type VotingStrategy = "best" | "merge";

export interface VotingExecuteOptions {
  /** Allocate one git worktree per candidate so siblings don't fight over the tree. */
  isolate?: boolean;
  /** Working directory of the host repo — needed when isolate=true. */
  cwd?: string;
  /** Apply the winning candidate's diff back into cwd. Requires isolate=true. */
  applyWinner?: boolean;
  /** Hard cost cap (USD) per candidate run. */
  maxCostPerCandidateUsd?: number;
  /** Keep worktrees on disk after the vote (debug). */
  keepWorktrees?: boolean;
}

export interface VotingCandidate {
  agent: string;
  output: string;
  exitCode: number;
  durationMs: number;
  cost?: number;
}

export interface VotingResult {
  strategy: VotingStrategy;
  candidates: VotingCandidate[];
  /** The judge's verdict output */
  verdict: string;
  /** Index of the winning candidate (for "best" strategy) */
  winnerIndex?: number;
  /** Name of the winning agent */
  winnerAgent?: string;
  judgeDurationMs: number;
  /** Path of the winner's worktree (when isolate=true). */
  winnerWorktreePath?: string;
  /** True when winner's diff was applied back into cwd. */
  winnerApplied?: boolean;
}

export interface VotingOutput {
  phase: "collecting" | "judging" | "done";
  agent?: string;
  output?: AgentOutput;
  result?: VotingResult;
  /** Candidate completed during collecting phase */
  candidateComplete?: VotingCandidate;
}

/**
 * Voting/consensus system: run a task on multiple agents in parallel,
 * then use a judge agent to pick the best answer or merge results.
 */
export class VotingSession extends EventEmitter {
  constructor(
    private agents: string[],
    private judgeAgent: string,
    private strategy: VotingStrategy,
    private processManager: ProcessManager,
    private adapters: Map<string, AgentAdapter>
  ) {
    super();
  }

  async *execute(
    task: string,
    execOpts: VotingExecuteOptions = {}
  ): AsyncGenerator<VotingOutput> {
    // Validate all agents exist
    for (const name of this.agents) {
      if (!this.adapters.has(name)) {
        throw new Error(`Agent "${name}" not found`);
      }
    }
    const judgeAdapter = this.adapters.get(this.judgeAgent);
    if (!judgeAdapter) {
      throw new Error(`Judge agent "${this.judgeAgent}" not found`);
    }

    // Phase 1: Run task on all agents in parallel, wait for completion
    yield { phase: "collecting" };

    const sessionIds = new Map<string, string>();
    const startTimes = new Map<string, number>();
    const worktrees = new Map<string, AllocatedWorktree>();
    const hostCwd = execOpts.cwd ?? process.cwd();

    try {
      if (execOpts.isolate) {
        for (const name of this.agents) {
          try {
            const wt = await allocateWorktree(hostCwd, { label: name, keepOnCleanup: execOpts.keepWorktrees });
            worktrees.set(name, wt);
          } catch (err) {
            // Roll back any partial allocations before bubbling.
            await Promise.allSettled(Array.from(worktrees.values()).map((w) => w.cleanup()));
            throw err;
          }
        }
      }

      for (const name of this.agents) {
      const adapter = this.adapters.get(name)!;
      startTimes.set(name, Date.now());
      const sessionId = await this.processManager.start(adapter, task, {
        cwd: worktrees.get(name)?.path,
        maxCostUsd: execOpts.maxCostPerCandidateUsd,
      });
      sessionIds.set(name, sessionId);
    }

    // Wait for all agents to complete using their done promises
    const donePromises: Promise<{ agent: string; exitCode: number }>[] = [];
    for (const [agentName, sessionId] of sessionIds) {
      const proc = this.processManager.get(sessionId);
      if (!proc) continue;
      donePromises.push(
        proc.done.then(({ exitCode }) => ({ agent: agentName, exitCode }))
      );
    }

    await Promise.allSettled(donePromises);

    // Collect results from buffers
    const candidates: VotingCandidate[] = [];
    for (const agentName of this.agents) {
      const sessionId = sessionIds.get(agentName);
      if (!sessionId) continue;
      const proc = this.processManager.get(sessionId);
      if (!proc) continue;

      const startTime = startTimes.get(agentName) ?? Date.now();
      const durationMs = Date.now() - startTime;

      let output = "";
      for (const entry of proc.buffer) {
        output += entry.data;
      }

      // Extract cost if available
      let cost: number | undefined;
      for (let i = proc.buffer.length - 1; i >= 0; i--) {
        const activity = proc.buffer[i].activity;
        if (activity && activity.kind === "cost") {
          cost = activity.totalCost;
          break;
        }
      }

      let exitCode = 0;
      try {
        const result = await proc.done;
        exitCode = result.exitCode;
      } catch {
        exitCode = 1;
      }

      const candidate: VotingCandidate = {
        agent: agentName,
        output: output.trim(),
        exitCode,
        durationMs,
        cost,
      };
      candidates.push(candidate);

      yield { phase: "collecting", candidateComplete: candidate };
    }

    // Phase 2: Judge evaluates the candidates
    yield { phase: "judging" };

    const judgePrompt = this.buildJudgePrompt(task, candidates);
    const judgeStart = Date.now();
    const judgeSessionId = await this.processManager.start(
      judgeAdapter,
      judgePrompt
    );
    const judgeProc = this.processManager.get(judgeSessionId);

    if (!judgeProc) {
      throw new Error("Failed to start judge agent");
    }

    let verdictOutput = "";
    for await (const chunk of judgeProc.output) {
      verdictOutput += chunk.data;
      yield {
        phase: "judging",
        agent: this.judgeAgent,
        output: chunk,
      };
    }

    const judgeDurationMs = Date.now() - judgeStart;

    // Try to extract winner from judge output
    const { winnerIndex, winnerAgent } = this.parseWinner(
      verdictOutput,
      candidates
    );

    const result: VotingResult = {
      strategy: this.strategy,
      candidates,
      verdict: verdictOutput.trim(),
      winnerIndex,
      winnerAgent,
      judgeDurationMs,
    };

    yield { phase: "done", result };
  }

  private buildJudgePrompt(
    task: string,
    candidates: VotingCandidate[]
  ): string {
    const candidateDescriptions = candidates
      .map(
        (c, i) =>
          `--- Candidate ${i + 1} (Agent: ${c.agent}, Duration: ${(c.durationMs / 1000).toFixed(1)}s, Exit: ${c.exitCode}) ---\n${c.output}\n--- End Candidate ${i + 1} ---`
      )
      .join("\n\n");

    if (this.strategy === "best") {
      return `You are a judge evaluating multiple AI agents' responses to the same task. Your job is to pick the BEST response.

ORIGINAL TASK:
${task}

CANDIDATES:
${candidateDescriptions}

INSTRUCTIONS:
1. Evaluate each candidate's response for correctness, completeness, code quality, and adherence to the task.
2. Pick the best candidate.
3. Start your response with "WINNER: Candidate N" (where N is 1-${candidates.length}).
4. Then explain your reasoning briefly.`;
    }

    // merge strategy
    return `You are a judge evaluating multiple AI agents' responses to the same task. Your job is to MERGE the best parts of all responses into a single superior response.

ORIGINAL TASK:
${task}

CANDIDATES:
${candidateDescriptions}

INSTRUCTIONS:
1. Analyze each candidate's response for strengths and weaknesses.
2. Create a merged response that combines the best elements from all candidates.
3. Start with "MERGED RESPONSE:" and then provide the unified result.
4. End with a brief "MERGE NOTES:" section explaining what you took from each candidate.`;
  }

  private parseWinner(
    verdict: string,
    candidates: VotingCandidate[]
  ): { winnerIndex?: number; winnerAgent?: string } {
    if (this.strategy !== "best") return {};

    // Look for "WINNER: Candidate N" pattern
    const match = verdict.match(/WINNER:\s*Candidate\s+(\d+)/i);
    if (match) {
      const idx = parseInt(match[1], 10) - 1;
      if (idx >= 0 && idx < candidates.length) {
        return {
          winnerIndex: idx,
          winnerAgent: candidates[idx].agent,
        };
      }
    }

    return {};
  }
}
