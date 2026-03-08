import { EventEmitter } from "node:events";
import type { AgentAdapter } from "../adapters/types.js";
import type { Config } from "../config/schema.js";
import { createAdapters } from "../adapters/factory.js";
import { ProcessManager } from "../core/process-manager.js";
import type {
  BenchProblem,
  BenchSuite,
  ProblemResult,
  SuiteRunResult,
  SuiteEvent,
} from "./types.js";
import { createWorkspace, removeWorkspace, type Workspace } from "./workspace.js";
import { runTestCases } from "./verifier.js";

export interface OrchestratorOptions {
  suites: BenchSuite[];
  agentNames?: string[];     // filter to specific agents
  keepWorkspaces?: boolean;  // don't clean up temp dirs
  config: Config;
}

export class SuiteOrchestrator extends EventEmitter {
  private options: OrchestratorOptions;
  private adapters: Map<string, AgentAdapter>;
  private workspaces: Workspace[] = [];

  constructor(options: OrchestratorOptions) {
    super();
    this.options = options;
    this.adapters = createAdapters(options.config);
  }

  /** Get the agent names that will be benchmarked */
  getAgentNames(): string[] {
    if (this.options.agentNames) {
      return this.options.agentNames.filter((n) => this.adapters.has(n));
    }
    return Array.from(this.adapters.keys());
  }

  /** Get display name for an agent */
  getDisplayName(agentName: string): string {
    return this.adapters.get(agentName)?.info.displayName ?? agentName;
  }

  /** Run all suites and return combined results */
  async run(): Promise<SuiteRunResult[]> {
    const results: SuiteRunResult[] = [];
    for (const suite of this.options.suites) {
      const result = await this.runSuite(suite);
      results.push(result);
    }
    return results;
  }

  /** Run a single suite */
  private async runSuite(suite: BenchSuite): Promise<SuiteRunResult> {
    const startedAt = Date.now();
    const agentNames = this.getAgentNames();
    const agentResults = new Map<string, ProblemResult[]>();

    for (const name of agentNames) {
      agentResults.set(name, []);
    }

    this.emit("event", {
      type: "suite:start",
      suiteId: suite.id,
      suiteName: suite.name,
    } satisfies SuiteEvent);

    for (const problem of suite.problems) {
      this.emit("event", {
        type: "problem:start",
        suiteId: suite.id,
        problemId: problem.id,
        problemName: problem.name,
      } satisfies SuiteEvent);

      // Run all agents on this problem in parallel
      const problemResults = await this.runProblem(suite.id, problem, agentNames);

      for (const result of problemResults) {
        agentResults.get(result.agentName)?.push(result);
      }

      this.emit("event", {
        type: "problem:done",
        suiteId: suite.id,
        problemId: problem.id,
      } satisfies SuiteEvent);
    }

    const suiteResult: SuiteRunResult = {
      suiteId: suite.id,
      suiteName: suite.name,
      agentResults,
      startedAt,
      finishedAt: Date.now(),
    };

    this.emit("event", {
      type: "suite:done",
      suiteId: suite.id,
      result: suiteResult,
    } satisfies SuiteEvent);

    return suiteResult;
  }

  /** Run all agents on a single problem in parallel */
  private async runProblem(
    suiteId: string,
    problem: BenchProblem,
    agentNames: string[]
  ): Promise<ProblemResult[]> {
    const promises = agentNames.map((agentName) =>
      this.runAgentOnProblem(suiteId, problem, agentName)
    );
    return Promise.all(promises);
  }

  /** Run a single agent on a single problem */
  private async runAgentOnProblem(
    suiteId: string,
    problem: BenchProblem,
    agentName: string
  ): Promise<ProblemResult> {
    const adapter = this.adapters.get(agentName);
    if (!adapter) {
      return this.errorResult(problem, agentName, "Agent not found");
    }

    this.emit("event", {
      type: "agent:start",
      suiteId,
      problemId: problem.id,
      agentName,
    } satisfies SuiteEvent);

    let workspace: Workspace | undefined;
    const startTime = Date.now();

    try {
      // Create isolated workspace
      workspace = await createWorkspace(problem, agentName);
      this.workspaces.push(workspace);

      // Spawn agent in workspace
      const pm = new ProcessManager(workspace.dir);
      const sessionId = await pm.start(adapter, problem.prompt, {
        cwd: workspace.dir,
      });

      const proc = pm.get(sessionId);
      if (!proc) {
        return this.errorResult(problem, agentName, "Failed to start agent");
      }

      // Wait for agent with timeout
      let timedOut = false;
      let exitCode: number | undefined;

      const timeoutPromise = new Promise<void>((resolve) => {
        setTimeout(async () => {
          timedOut = true;
          await pm.stop(sessionId);
          resolve();
        }, problem.timeLimitSeconds * 1000);
      });

      const donePromise = proc.done.then(({ exitCode: code }) => {
        exitCode = code;
      });

      await Promise.race([donePromise, timeoutPromise]);

      const elapsed = Date.now() - startTime;

      // Extract cost from Claude activity data
      let cost: number | undefined;
      for (let i = proc.buffer.length - 1; i >= 0; i--) {
        const activity = proc.buffer[i].activity;
        if (activity && activity.kind === "cost") {
          cost = activity.totalCost;
          break;
        }
      }

      // Run tests in workspace
      const testCaseResults = runTestCases(problem.testCases, workspace.dir);
      const passedCount = testCaseResults.filter((t) => t.passed).length;

      const result: ProblemResult = {
        problemId: problem.id,
        problemName: problem.name,
        agentName,
        displayName: this.getDisplayName(agentName),
        passed: passedCount === testCaseResults.length && !timedOut,
        testCaseResults,
        passedCount,
        totalCount: testCaseResults.length,
        timeMs: elapsed,
        exitCode,
        cost,
        timedOut,
      };

      await pm.stopAll();

      this.emit("event", {
        type: "agent:done",
        suiteId,
        problemId: problem.id,
        agentName,
        result,
      } satisfies SuiteEvent);

      return result;
    } catch (err) {
      const result = this.errorResult(
        problem,
        agentName,
        err instanceof Error ? err.message : "Unknown error",
        Date.now() - startTime
      );

      this.emit("event", {
        type: "agent:done",
        suiteId,
        problemId: problem.id,
        agentName,
        result,
      } satisfies SuiteEvent);

      return result;
    } finally {
      // Cleanup workspace unless keeping
      if (workspace && !this.options.keepWorkspaces) {
        removeWorkspace(workspace);
      }
    }
  }

  private errorResult(
    problem: BenchProblem,
    agentName: string,
    error: string,
    timeMs = 0
  ): ProblemResult {
    return {
      problemId: problem.id,
      problemName: problem.name,
      agentName,
      displayName: this.getDisplayName(agentName),
      passed: false,
      testCaseResults: [],
      passedCount: 0,
      totalCount: problem.testCases.length,
      timeMs,
      exitCode: undefined,
      cost: undefined,
      timedOut: false,
      error,
    };
  }

  /** Get workspace paths (useful when --keep-workspaces is set) */
  getWorkspaces(): Workspace[] {
    return this.workspaces;
  }
}
