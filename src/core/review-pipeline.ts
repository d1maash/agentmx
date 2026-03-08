import type { AgentAdapter, AgentOutput } from "../adapters/types.js";
import type { ProcessManager } from "./process-manager.js";

export type ReviewStage = "code" | "review" | "test";

export interface ReviewRoles {
  coder: string;
  reviewer: string;
  tester: string;
}

export interface ReviewStageResult {
  stage: ReviewStage;
  agent: string;
  output: string;
  exitCode: number;
  durationMs: number;
}

export interface ReviewPipelineOutput {
  stage: ReviewStage;
  agent: string;
  output?: AgentOutput;
  stageComplete?: boolean;
  stageResult?: ReviewStageResult;
  allResults?: ReviewStageResult[];
}

/**
 * Review pipeline: one agent writes code, another reviews it,
 * a third writes tests. Each stage sees all previous context.
 */
export class ReviewPipeline {
  constructor(
    private roles: ReviewRoles,
    private processManager: ProcessManager,
    private adapters: Map<string, AgentAdapter>
  ) {}

  async *execute(task: string): AsyncGenerator<ReviewPipelineOutput> {
    // Validate all agents
    for (const [role, name] of Object.entries(this.roles)) {
      if (!this.adapters.has(name)) {
        throw new Error(`Agent "${name}" for role "${role}" not found`);
      }
    }

    const results: ReviewStageResult[] = [];

    // Stage 1: Coder writes code
    const coderResult = yield* this.runStage(
      "code",
      this.roles.coder,
      this.buildCoderPrompt(task)
    );
    results.push(coderResult);

    // Stage 2: Reviewer reviews the code
    const reviewerResult = yield* this.runStage(
      "review",
      this.roles.reviewer,
      this.buildReviewerPrompt(task, coderResult.output)
    );
    results.push(reviewerResult);

    // Stage 3: Tester writes tests
    const testerResult = yield* this.runStage(
      "test",
      this.roles.tester,
      this.buildTesterPrompt(task, coderResult.output, reviewerResult.output)
    );
    results.push(testerResult);

    // Yield final summary
    yield {
      stage: "test",
      agent: this.roles.tester,
      allResults: results,
    };
  }

  private async *runStage(
    stage: ReviewStage,
    agentName: string,
    prompt: string
  ): AsyncGenerator<ReviewPipelineOutput, ReviewStageResult> {
    const adapter = this.adapters.get(agentName)!;
    const startTime = Date.now();
    const sessionId = await this.processManager.start(adapter, prompt);
    const proc = this.processManager.get(sessionId);

    if (!proc) {
      throw new Error(`Failed to start ${agentName} for ${stage} stage`);
    }

    let output = "";
    for await (const chunk of proc.output) {
      output += chunk.data;
      yield {
        stage,
        agent: agentName,
        output: chunk,
      };
    }

    const { exitCode } = await proc.done;
    const durationMs = Date.now() - startTime;

    const result: ReviewStageResult = {
      stage,
      agent: agentName,
      output: output.trim(),
      exitCode,
      durationMs,
    };

    yield {
      stage,
      agent: agentName,
      stageComplete: true,
      stageResult: result,
    };

    return result;
  }

  private buildCoderPrompt(task: string): string {
    return `You are a coder. Your job is to implement the following task. Write clean, working code.

TASK:
${task}

Focus on writing correct, well-structured code. Another agent will review your code afterwards, and a third agent will write tests for it.`;
  }

  private buildReviewerPrompt(task: string, coderOutput: string): string {
    return `You are a code reviewer. Another agent has written code for a task, and your job is to review it thoroughly.

ORIGINAL TASK:
${task}

CODE WRITTEN BY THE CODER:
${coderOutput}

REVIEW INSTRUCTIONS:
1. Check for bugs, logic errors, and edge cases.
2. Evaluate code quality, readability, and best practices.
3. Check for security vulnerabilities.
4. Suggest specific improvements with code examples if needed.
5. If the code has critical issues, provide corrected code.
6. Rate the code: PASS (good to go), NEEDS_CHANGES (minor issues), or FAIL (major issues).

Start your review with "VERDICT: PASS|NEEDS_CHANGES|FAIL" then explain.`;
  }

  private buildTesterPrompt(
    task: string,
    coderOutput: string,
    reviewOutput: string
  ): string {
    return `You are a test engineer. A coder wrote code for a task, and a reviewer has reviewed it. Your job is to write comprehensive tests.

ORIGINAL TASK:
${task}

CODE WRITTEN BY THE CODER:
${coderOutput}

CODE REVIEW:
${reviewOutput}

TESTING INSTRUCTIONS:
1. Write comprehensive unit tests covering all functions and methods.
2. Include edge cases and error scenarios.
3. Include integration tests if applicable.
4. Take the reviewer's feedback into account — test for any issues they flagged.
5. Use the appropriate testing framework for the language used.
6. Make sure tests are runnable.`;
  }
}
