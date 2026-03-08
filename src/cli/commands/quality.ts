import chalk from "chalk";
import { runQualityCheck, type QualityScore } from "../../core/quality-scorer.js";

function scoreColor(score: number): typeof chalk {
  if (score < 0) return chalk.dim;
  if (score >= 80) return chalk.green;
  if (score >= 50) return chalk.yellow;
  return chalk.red;
}

function scoreBar(score: number, width = 20): string {
  if (score < 0) return chalk.dim("N/A".padEnd(width));
  const filled = Math.round((score / 100) * width);
  const empty = width - filled;
  const color = score >= 80 ? "green" : score >= 50 ? "yellow" : "red";
  return chalk[color]("█".repeat(filled)) + chalk.dim("░".repeat(empty)) + ` ${score}%`;
}

function gradeLabel(score: number): string {
  if (score >= 90) return chalk.green.bold("A");
  if (score >= 80) return chalk.green("B");
  if (score >= 70) return chalk.yellow("C");
  if (score >= 50) return chalk.yellow("D");
  return chalk.red("F");
}

export async function qualityCommand(opts: { path?: string }): Promise<void> {
  const cwd = opts.path ?? process.cwd();

  console.log();
  console.log(chalk.bold.underline("AgentMX Quality Score"));
  console.log(chalk.dim(`Scanning: ${cwd}`));
  console.log();

  console.log(chalk.dim("Running checks..."));

  const result = runQualityCheck(cwd);

  // Clear the "Running checks..." line
  process.stdout.write("\x1b[1A\x1b[2K");

  // Overall score
  console.log(`  ${chalk.bold("Overall:")}  ${scoreBar(result.overall, 25)}  ${gradeLabel(result.overall)}`);
  console.log();

  // Linting
  console.log(chalk.bold("  Linting"));
  if (!result.linting.available) {
    console.log(chalk.dim("    No linter detected (eslint, biome)"));
  } else {
    console.log(`    Score:    ${scoreBar(result.linting.score)}`);
    console.log(`    Tool:     ${result.linting.tool}`);
    console.log(`    Errors:   ${result.linting.errorCount > 0 ? chalk.red(String(result.linting.errorCount)) : chalk.green("0")}`);
    console.log(`    Warnings: ${result.linting.warningCount > 0 ? chalk.yellow(String(result.linting.warningCount)) : chalk.green("0")}`);
  }
  console.log();

  // Tests
  console.log(chalk.bold("  Tests"));
  if (!result.tests.available) {
    console.log(chalk.dim("    No test framework detected (vitest, jest, pytest, go test)"));
  } else {
    console.log(`    Score:   ${scoreBar(result.tests.score)}`);
    console.log(`    Tool:    ${result.tests.tool}`);
    console.log(`    Passed:  ${chalk.green(String(result.tests.passed))}`);
    console.log(`    Failed:  ${result.tests.failed > 0 ? chalk.red(String(result.tests.failed)) : chalk.green("0")}`);
    console.log(`    Total:   ${result.tests.total}`);
  }
  console.log();

  // Complexity
  console.log(chalk.bold("  Complexity"));
  console.log(`    Score:          ${scoreBar(result.complexity.score)}`);
  console.log(`    Total Files:    ${result.complexity.totalFiles}`);
  console.log(`    Avg Lines/File: ${result.complexity.avgLinesPerFile}`);
  console.log(`    Large Files:    ${result.complexity.largeFiles > 0 ? chalk.yellow(String(result.complexity.largeFiles)) : chalk.green("0")} ${chalk.dim("(>300 lines)")}`);

  console.log();
}
