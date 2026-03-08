import { execSync } from "node:child_process";
import type { TestCase, TestCaseResult } from "./types.js";

/**
 * Runs the verify command in the workspace directory.
 * Returns true if the command exits with code 0.
 */
export function runVerifyCommand(
  verifyCommand: string,
  cwd: string
): boolean {
  try {
    execSync(verifyCommand, {
      cwd,
      timeout: 30_000,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs individual test cases in the workspace and returns per-test results.
 */
export function runTestCases(
  testCases: TestCase[],
  cwd: string
): TestCaseResult[] {
  return testCases.map((tc) => {
    try {
      const output = execSync(tc.command, {
        cwd,
        timeout: 30_000,
        stdio: "pipe",
      });
      return {
        name: tc.name,
        passed: true,
        output: output.toString("utf-8").slice(0, 2000),
      };
    } catch (err) {
      const output =
        err instanceof Error && "stderr" in err
          ? String((err as any).stderr).slice(0, 2000)
          : err instanceof Error
            ? err.message.slice(0, 2000)
            : "Unknown error";
      return {
        name: tc.name,
        passed: false,
        output,
      };
    }
  });
}
