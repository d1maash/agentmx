import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface QualityScore {
  overall: number; // 0-100
  linting: LintResult;
  tests: TestResult;
  complexity: ComplexityResult;
  timestamp: number;
}

export interface LintResult {
  score: number; // 0-100
  errorCount: number;
  warningCount: number;
  tool: string;
  available: boolean;
}

export interface TestResult {
  score: number; // 0-100
  passed: number;
  failed: number;
  total: number;
  tool: string;
  available: boolean;
}

export interface ComplexityResult {
  score: number; // 0-100
  totalFiles: number;
  avgLinesPerFile: number;
  largeFiles: number; // files > 300 lines
  tool: string;
}

function tryExec(cmd: string, cwd: string, timeout = 30_000): { ok: boolean; stdout: string; stderr: string } {
  try {
    const stdout = execSync(cmd, {
      cwd,
      timeout,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { ok: true, stdout, stderr: "" };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    return { ok: false, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

function detectLintTool(cwd: string): string | null {
  if (existsSync(join(cwd, "biome.json")) || existsSync(join(cwd, "biome.jsonc"))) {
    return "biome";
  }
  if (existsSync(join(cwd, ".eslintrc")) ||
      existsSync(join(cwd, ".eslintrc.js")) ||
      existsSync(join(cwd, ".eslintrc.json")) ||
      existsSync(join(cwd, ".eslintrc.yml")) ||
      existsSync(join(cwd, "eslint.config.js")) ||
      existsSync(join(cwd, "eslint.config.mjs")) ||
      existsSync(join(cwd, "eslint.config.ts"))) {
    return "eslint";
  }
  // Check package.json for eslint/biome dep
  try {
    const pkg = JSON.parse(
      execSync("cat package.json", { cwd, encoding: "utf-8" })
    );
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };
    if (allDeps["@biomejs/biome"]) return "biome";
    if (allDeps.eslint) return "eslint";
  } catch {
    // no package.json
  }
  return null;
}

function runLint(cwd: string): LintResult {
  const tool = detectLintTool(cwd);

  if (!tool) {
    return { score: -1, errorCount: 0, warningCount: 0, tool: "none", available: false };
  }

  if (tool === "biome") {
    const result = tryExec("npx biome check . --reporter=summary 2>&1", cwd);
    const output = result.stdout + result.stderr;
    // Parse biome output
    const errorMatch = output.match(/Found (\d+) error/);
    const warnMatch = output.match(/Found (\d+) warning/);
    const errors = errorMatch ? parseInt(errorMatch[1], 10) : 0;
    const warnings = warnMatch ? parseInt(warnMatch[1], 10) : 0;

    // Score: 100 - (errors * 5 + warnings * 1), min 0
    const score = Math.max(0, 100 - errors * 5 - warnings);

    return { score, errorCount: errors, warningCount: warnings, tool: "biome", available: true };
  }

  // eslint
  const result = tryExec("npx eslint . --format json 2>/dev/null", cwd, 60_000);
  try {
    const parsed = JSON.parse(result.stdout);
    let errors = 0;
    let warnings = 0;
    for (const file of parsed) {
      errors += file.errorCount ?? 0;
      warnings += file.warningCount ?? 0;
    }
    const score = Math.max(0, 100 - errors * 5 - warnings);
    return { score, errorCount: errors, warningCount: warnings, tool: "eslint", available: true };
  } catch {
    // Couldn't parse — try simple text parse
    const errorMatch = result.stdout.match(/(\d+) error/);
    const warnMatch = result.stdout.match(/(\d+) warning/);
    const errors = errorMatch ? parseInt(errorMatch[1], 10) : 0;
    const warnings = warnMatch ? parseInt(warnMatch[1], 10) : 0;
    const score = result.ok ? 100 : Math.max(0, 100 - errors * 5 - warnings);
    return { score, errorCount: errors, warningCount: warnings, tool: "eslint", available: true };
  }
}

function detectTestTool(cwd: string): string | null {
  try {
    const pkg = JSON.parse(
      execSync("cat package.json", { cwd, encoding: "utf-8" })
    );
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (allDeps.vitest) return "vitest";
    if (allDeps.jest) return "jest";
    if (allDeps.mocha) return "mocha";

    // Check scripts
    const scripts = pkg.scripts ?? {};
    if (scripts.test) return "npm-test";
  } catch {
    // No package.json
  }

  // Check for pytest
  if (existsSync(join(cwd, "pytest.ini")) ||
      existsSync(join(cwd, "pyproject.toml")) ||
      existsSync(join(cwd, "setup.py"))) {
    return "pytest";
  }

  // Check for go tests
  if (existsSync(join(cwd, "go.mod"))) {
    return "go-test";
  }

  return null;
}

function runTests(cwd: string): TestResult {
  const tool = detectTestTool(cwd);

  if (!tool) {
    return { score: -1, passed: 0, failed: 0, total: 0, tool: "none", available: false };
  }

  let cmd: string;
  switch (tool) {
    case "vitest":
      cmd = "npx vitest run --reporter=json 2>/dev/null";
      break;
    case "jest":
      cmd = "npx jest --json --silent 2>/dev/null";
      break;
    case "pytest":
      cmd = "python -m pytest --tb=no -q 2>&1";
      break;
    case "go-test":
      cmd = "go test ./... -json 2>&1";
      break;
    default:
      cmd = "npm test 2>&1";
      break;
  }

  const result = tryExec(cmd, cwd, 120_000);
  const output = result.stdout + result.stderr;

  // Try JSON parsing for vitest/jest
  if (tool === "vitest" || tool === "jest") {
    try {
      // Find JSON in output (vitest may print other text before JSON)
      const jsonStart = output.indexOf("{");
      if (jsonStart >= 0) {
        const json = JSON.parse(output.slice(jsonStart));
        const passed = json.numPassedTests ?? json.testResults?.filter((t: { status: string }) => t.status === "passed").length ?? 0;
        const failed = json.numFailedTests ?? json.testResults?.filter((t: { status: string }) => t.status === "failed").length ?? 0;
        const total = passed + failed;
        const score = total > 0 ? Math.round((passed / total) * 100) : (result.ok ? 100 : 0);
        return { score, passed, failed, total, tool, available: true };
      }
    } catch {
      // Fall through to text parsing
    }
  }

  // Text-based parsing fallback
  const passMatch = output.match(/(\d+)\s+pass/i);
  const failMatch = output.match(/(\d+)\s+fail/i);
  const passed = passMatch ? parseInt(passMatch[1], 10) : 0;
  const failed = failMatch ? parseInt(failMatch[1], 10) : 0;
  const total = passed + failed;
  const score = total > 0
    ? Math.round((passed / total) * 100)
    : (result.ok ? 100 : 0);

  return { score, passed, failed, total, tool, available: true };
}

function analyzeComplexity(cwd: string): ComplexityResult {
  // Count source files and their sizes
  const extensions = [
    "ts", "tsx", "js", "jsx", "py", "go", "rs", "java", "rb", "php",
  ];
  const globPattern = extensions.map((e) => `--include='*.${e}'`).join(" ");

  const result = tryExec(
    `find . -type f \\( ${extensions.map((e) => `-name '*.${e}'`).join(" -o ")} \\) -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/build/*' | head -500`,
    cwd
  );

  const files = result.stdout.trim().split("\n").filter((f) => f.length > 0);
  const totalFiles = files.length;

  if (totalFiles === 0) {
    return { score: 100, totalFiles: 0, avgLinesPerFile: 0, largeFiles: 0, tool: "line-count" };
  }

  let totalLines = 0;
  let largeFiles = 0;

  for (const file of files) {
    try {
      const wc = tryExec(`wc -l "${file}"`, cwd);
      const lines = parseInt(wc.stdout.trim().split(/\s+/)[0], 10) || 0;
      totalLines += lines;
      if (lines > 300) largeFiles++;
    } catch {
      // Skip unreadable files
    }
  }

  const avgLinesPerFile = totalFiles > 0 ? Math.round(totalLines / totalFiles) : 0;

  // Score: penalize for high avg and many large files
  // avg < 100 = 100 pts, avg > 300 = 0 pts
  const avgScore = Math.max(0, Math.min(100, 100 - ((avgLinesPerFile - 100) / 200) * 100));
  // large files ratio: 0% = 100pts, 50%+ = 0pts
  const largeRatio = totalFiles > 0 ? largeFiles / totalFiles : 0;
  const largeScore = Math.max(0, 100 - largeRatio * 200);
  const score = Math.round((avgScore + largeScore) / 2);

  return { score, totalFiles, avgLinesPerFile, largeFiles, tool: "line-count" };
}

export function runQualityCheck(cwd?: string): QualityScore {
  const dir = cwd ?? process.cwd();

  const linting = runLint(dir);
  const tests = runTests(dir);
  const complexity = analyzeComplexity(dir);

  // Compute overall: weighted average of available scores
  const scores: Array<{ score: number; weight: number }> = [];
  if (linting.available) scores.push({ score: linting.score, weight: 3 });
  if (tests.available) scores.push({ score: tests.score, weight: 4 });
  scores.push({ score: complexity.score, weight: 2 });

  const totalWeight = scores.reduce((sum, s) => sum + s.weight, 0);
  const overall = totalWeight > 0
    ? Math.round(scores.reduce((sum, s) => sum + s.score * s.weight, 0) / totalWeight)
    : complexity.score;

  return {
    overall,
    linting,
    tests,
    complexity,
    timestamp: Date.now(),
  };
}
