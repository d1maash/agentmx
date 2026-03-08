export interface TestCase {
  name: string;
  command: string; // e.g. "npx vitest run --reporter=json test/fib.test.ts"
}

export interface BenchProblem {
  id: string;
  name: string;
  prompt: string;
  language: "typescript";
  difficulty: "easy" | "medium" | "hard";
  timeLimitSeconds: number;
  scaffoldFiles: Record<string, string>; // relative path -> content
  verifyCommand: string; // quick overall pass/fail check
  testCases: TestCase[];
}

export interface BenchSuite {
  id: string;
  name: string;
  description: string;
  problems: BenchProblem[];
}

export interface TestCaseResult {
  name: string;
  passed: boolean;
  output: string;
}

export interface ProblemResult {
  problemId: string;
  problemName: string;
  agentName: string;
  displayName: string;
  passed: boolean;
  testCaseResults: TestCaseResult[];
  passedCount: number;
  totalCount: number;
  timeMs: number;
  exitCode: number | undefined;
  cost: number | undefined;
  timedOut: boolean;
  error?: string;
}

export interface SuiteRunResult {
  suiteId: string;
  suiteName: string;
  agentResults: Map<string, ProblemResult[]>; // agentName -> results per problem
  startedAt: number;
  finishedAt: number;
}

export type SuiteEvent =
  | { type: "suite:start"; suiteId: string; suiteName: string }
  | { type: "problem:start"; suiteId: string; problemId: string; problemName: string }
  | { type: "agent:start"; suiteId: string; problemId: string; agentName: string }
  | { type: "agent:done"; suiteId: string; problemId: string; agentName: string; result: ProblemResult }
  | { type: "problem:done"; suiteId: string; problemId: string }
  | { type: "suite:done"; suiteId: string; result: SuiteRunResult };
