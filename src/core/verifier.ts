import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Verification-first workflow.
 *
 * The judge does not pick "by pretty answer". It looks at:
 *   - diff
 *   - tests
 *   - lint / typecheck
 *   - runtime errors
 *   - changed files
 *   - task compliance
 *
 * `verifySolution()` runs each check, returns a `VerificationProof`
 * describing why the patch is (or isn't) good enough to ship.
 */

export type CheckStatus = "pass" | "fail" | "skip";

export interface CheckResult {
  name: string;
  status: CheckStatus;
  /** 0..100 — `null` when the check was skipped. */
  score: number | null;
  /** Short single-line summary shown in the proof header. */
  summary: string;
  /** Multi-line details: failing tests, error excerpts, etc. */
  details?: string;
  /** Weight used when computing the overall score. */
  weight: number;
}

export interface DiffStats {
  filesChanged: number;
  insertions: number;
  deletions: number;
  files: string[];
}

export interface VerificationProof {
  /** Whether every non-skipped, non-zero-weight check passed. */
  verdict: "pass" | "fail";
  /** Weighted average across available checks (0..100). */
  overallScore: number;
  patch: string;
  diffStats: DiffStats;
  checks: CheckResult[];
  taskSummary: string;
  durationMs: number;
}

export interface VerifyOptions {
  cwd: string;
  task: string;
  /** Git revision to diff against (default: HEAD). */
  baseRef?: string;
  /** Run tests as part of verification (default: true). */
  runTests?: boolean;
  /** Run lint as part of verification (default: true). */
  runLint?: boolean;
  /** Run typecheck as part of verification (default: true). */
  runTypecheck?: boolean;
  /** Per-check timeout (ms). Default: 120s. */
  timeoutMs?: number;
}

interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  combined: string;
}

function tryExec(
  cmd: string,
  cwd: string,
  timeout = 120_000
): ExecResult {
  try {
    const stdout = execSync(cmd, {
      cwd,
      timeout,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CI: "1", FORCE_COLOR: "0" },
    });
    return { ok: true, stdout, stderr: "", combined: stdout };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const stdout = e.stdout?.toString() ?? "";
    const stderr = e.stderr?.toString() ?? e.message ?? "";
    return { ok: false, stdout, stderr, combined: stdout + stderr };
  }
}

function isGitRepo(cwd: string): boolean {
  return tryExec("git rev-parse --is-inside-work-tree", cwd, 5_000).ok;
}

function tail(text: string, lines = 40): string {
  const arr = text.replace(/\r/g, "").split("\n");
  return arr.slice(-lines).join("\n").trim();
}

/* ───────────────── Diff capture ──────────────────────────────────────── */

export function captureDiff(cwd: string, baseRef = "HEAD"): {
  patch: string;
  stats: DiffStats;
} {
  if (!isGitRepo(cwd)) {
    return {
      patch: "",
      stats: { filesChanged: 0, insertions: 0, deletions: 0, files: [] },
    };
  }

  const tracked = tryExec(`git diff ${baseRef} --`, cwd, 30_000).stdout;
  const untrackedList = tryExec(
    "git ls-files --others --exclude-standard",
    cwd,
    10_000
  ).stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  let untracked = "";
  for (const file of untrackedList) {
    const piece = tryExec(
      `git diff --no-index -- /dev/null "${file}"`,
      cwd,
      10_000
    );
    untracked += piece.stdout;
  }

  const patch = tracked + untracked;

  const numstat =
    tryExec(`git diff ${baseRef} --numstat`, cwd, 10_000).stdout +
    untrackedList
      .map((f) => {
        const r = tryExec(
          `git diff --no-index --numstat -- /dev/null "${f}"`,
          cwd,
          10_000
        );
        return r.stdout;
      })
      .join("");

  let insertions = 0;
  let deletions = 0;
  const fileSet = new Set<string>();
  for (const line of numstat.split("\n")) {
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!m) continue;
    if (m[1] !== "-") insertions += parseInt(m[1], 10);
    if (m[2] !== "-") deletions += parseInt(m[2], 10);
    // git diff --no-index against /dev/null reports paths as "/dev/null => foo"
    const path = m[3].replace(/^\/dev\/null\s*=>\s*/, "").replace(/^"(.+)"$/, "$1");
    fileSet.add(path);
  }

  return {
    patch,
    stats: {
      filesChanged: fileSet.size,
      insertions,
      deletions,
      files: [...fileSet].sort(),
    },
  };
}

/* ───────────────── Tool detection ────────────────────────────────────── */

function readPkg(cwd: string): Record<string, unknown> | null {
  const path = join(cwd, "package.json");
  if (!existsSync(path)) return null;
  const r = tryExec(`cat "${path}"`, cwd, 5_000);
  if (!r.ok) return null;
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

function detectTestTool(cwd: string): string | null {
  const pkg = readPkg(cwd);
  if (pkg) {
    const deps = {
      ...((pkg as any).dependencies ?? {}),
      ...((pkg as any).devDependencies ?? {}),
    };
    if (deps.vitest) return "vitest";
    if (deps.jest) return "jest";
    const scripts = (pkg as any).scripts ?? {};
    if (scripts.test) return "npm-test";
  }
  if (
    existsSync(join(cwd, "pytest.ini")) ||
    existsSync(join(cwd, "pyproject.toml"))
  )
    return "pytest";
  if (existsSync(join(cwd, "go.mod"))) return "go-test";
  if (existsSync(join(cwd, "Cargo.toml"))) return "cargo-test";
  return null;
}

function detectTypecheckTool(cwd: string): { cmd: string; tool: string } | null {
  const pkg = readPkg(cwd);
  if (pkg) {
    const scripts = ((pkg as any).scripts ?? {}) as Record<string, string>;
    if (scripts.typecheck) return { cmd: "npm run -s typecheck", tool: "npm:typecheck" };
    if (scripts["type-check"]) return { cmd: "npm run -s type-check", tool: "npm:type-check" };
    const deps = {
      ...((pkg as any).dependencies ?? {}),
      ...((pkg as any).devDependencies ?? {}),
    };
    if (deps.typescript || existsSync(join(cwd, "tsconfig.json"))) {
      return { cmd: "npx -y tsc --noEmit", tool: "tsc" };
    }
  } else if (existsSync(join(cwd, "tsconfig.json"))) {
    return { cmd: "npx -y tsc --noEmit", tool: "tsc" };
  }
  if (existsSync(join(cwd, "pyproject.toml"))) {
    if (tryExec("which mypy", cwd, 3_000).ok) {
      return { cmd: "mypy .", tool: "mypy" };
    }
  }
  if (existsSync(join(cwd, "go.mod"))) {
    return { cmd: "go vet ./...", tool: "go-vet" };
  }
  return null;
}

function detectLintTool(cwd: string): { cmd: string; tool: string } | null {
  if (
    existsSync(join(cwd, "biome.json")) ||
    existsSync(join(cwd, "biome.jsonc"))
  ) {
    return { cmd: "npx -y @biomejs/biome check .", tool: "biome" };
  }
  if (
    existsSync(join(cwd, ".eslintrc")) ||
    existsSync(join(cwd, ".eslintrc.js")) ||
    existsSync(join(cwd, ".eslintrc.json")) ||
    existsSync(join(cwd, "eslint.config.js")) ||
    existsSync(join(cwd, "eslint.config.mjs"))
  ) {
    return { cmd: "npx -y eslint . --max-warnings=0", tool: "eslint" };
  }
  const pkg = readPkg(cwd);
  if (pkg) {
    const deps = {
      ...((pkg as any).dependencies ?? {}),
      ...((pkg as any).devDependencies ?? {}),
    };
    if (deps["@biomejs/biome"])
      return { cmd: "npx -y @biomejs/biome check .", tool: "biome" };
    if (deps.eslint)
      return { cmd: "npx -y eslint . --max-warnings=0", tool: "eslint" };
    const scripts = ((pkg as any).scripts ?? {}) as Record<string, string>;
    if (scripts.lint) return { cmd: "npm run -s lint", tool: "npm:lint" };
  }
  if (existsSync(join(cwd, "pyproject.toml"))) {
    if (tryExec("which ruff", cwd, 3_000).ok) {
      return { cmd: "ruff check .", tool: "ruff" };
    }
  }
  return null;
}

/* ───────────────── Individual checks ─────────────────────────────────── */

function checkDiff(
  stats: DiffStats,
  patch: string
): CheckResult {
  if (stats.filesChanged === 0 && patch.length === 0) {
    return {
      name: "diff",
      status: "fail",
      score: 0,
      summary: "No changes detected — agent did not produce a patch",
      weight: 5,
    };
  }
  return {
    name: "diff",
    status: "pass",
    score: 100,
    summary: `${stats.filesChanged} file(s) changed, +${stats.insertions} -${stats.deletions}`,
    details: stats.files.slice(0, 25).join("\n"),
    weight: 1,
  };
}

function checkTests(cwd: string, timeoutMs: number): CheckResult {
  const tool = detectTestTool(cwd);
  if (!tool) {
    return {
      name: "tests",
      status: "skip",
      score: null,
      summary: "no test framework detected",
      weight: 0,
    };
  }
  const cmd = (() => {
    switch (tool) {
      case "vitest":
        return "npx -y vitest run --reporter=default";
      case "jest":
        return "npx -y jest --silent";
      case "pytest":
        return "python -m pytest -q";
      case "go-test":
        return "go test ./...";
      case "cargo-test":
        return "cargo test";
      default:
        return "npm test --silent";
    }
  })();
  const r = tryExec(cmd, cwd, timeoutMs);
  return {
    name: "tests",
    status: r.ok ? "pass" : "fail",
    score: r.ok ? 100 : 0,
    summary: r.ok ? `${tool}: all tests passed` : `${tool}: tests failed`,
    details: r.ok ? undefined : tail(r.combined, 60),
    weight: 4,
  };
}

function checkTypecheck(cwd: string, timeoutMs: number): CheckResult {
  const detected = detectTypecheckTool(cwd);
  if (!detected) {
    return {
      name: "typecheck",
      status: "skip",
      score: null,
      summary: "no typecheck tool detected",
      weight: 0,
    };
  }
  const r = tryExec(detected.cmd, cwd, timeoutMs);
  return {
    name: "typecheck",
    status: r.ok ? "pass" : "fail",
    score: r.ok ? 100 : 0,
    summary: r.ok ? `${detected.tool}: clean` : `${detected.tool}: errors`,
    details: r.ok ? undefined : tail(r.combined, 40),
    weight: 3,
  };
}

function checkLint(cwd: string, timeoutMs: number): CheckResult {
  const detected = detectLintTool(cwd);
  if (!detected) {
    return {
      name: "lint",
      status: "skip",
      score: null,
      summary: "no linter detected",
      weight: 0,
    };
  }
  const r = tryExec(detected.cmd, cwd, timeoutMs);
  return {
    name: "lint",
    status: r.ok ? "pass" : "fail",
    score: r.ok ? 100 : 0,
    summary: r.ok ? `${detected.tool}: clean` : `${detected.tool}: issues`,
    details: r.ok ? undefined : tail(r.combined, 40),
    weight: 2,
  };
}

/**
 * Naive task-compliance heuristic: extract obvious file/symbol hints from
 * the task and check whether the diff touches them. This isn't a model —
 * it just catches the case where the agent shipped a patch unrelated to
 * what was asked.
 */
function checkCompliance(task: string, stats: DiffStats): CheckResult {
  const fileHints = [...task.matchAll(/[\w./-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|rb|php|md)\b/g)]
    .map((m) => m[0])
    .map((p) => p.replace(/^\.\//, ""));

  if (fileHints.length === 0) {
    return {
      name: "compliance",
      status: "skip",
      score: null,
      summary: "no explicit file hints in task",
      weight: 0,
    };
  }

  const touched = stats.files.map((f) => f.replace(/^\.\//, ""));
  const matched = fileHints.filter((hint) =>
    touched.some((t) => t === hint || t.endsWith("/" + hint))
  );

  if (matched.length === fileHints.length) {
    return {
      name: "compliance",
      status: "pass",
      score: 100,
      summary: `patch touches all ${matched.length} file(s) named in task`,
      weight: 1,
    };
  }

  if (matched.length === 0) {
    return {
      name: "compliance",
      status: "fail",
      score: 0,
      summary: `patch does not touch any file named in task (expected ${fileHints.join(", ")})`,
      weight: 2,
    };
  }

  return {
    name: "compliance",
      status: "fail",
    score: Math.round((matched.length / fileHints.length) * 100),
    summary: `patch touches ${matched.length}/${fileHints.length} file(s) named in task`,
    details: `missing: ${fileHints.filter((h) => !matched.includes(h)).join(", ")}`,
    weight: 1,
  };
}

/* ───────────────── Main entry point ──────────────────────────────────── */

export function verifySolution(opts: VerifyOptions): VerificationProof {
  const start = Date.now();
  const baseRef = opts.baseRef ?? "HEAD";
  const timeoutMs = opts.timeoutMs ?? 120_000;

  const { patch, stats } = captureDiff(opts.cwd, baseRef);

  const checks: CheckResult[] = [];
  checks.push(checkDiff(stats, patch));

  if (opts.runTests !== false) {
    checks.push(checkTests(opts.cwd, timeoutMs));
  }
  if (opts.runTypecheck !== false) {
    checks.push(checkTypecheck(opts.cwd, timeoutMs));
  }
  if (opts.runLint !== false) {
    checks.push(checkLint(opts.cwd, timeoutMs));
  }
  checks.push(checkCompliance(opts.task, stats));

  const overallScore = computeOverallScore(checks);
  const verdict = checks.some((c) => c.status === "fail" && c.weight > 0)
    ? "fail"
    : "pass";

  return {
    verdict,
    overallScore,
    patch,
    diffStats: stats,
    checks,
    taskSummary: opts.task.trim().split("\n")[0].slice(0, 200),
    durationMs: Date.now() - start,
  };
}

export function computeOverallScore(checks: CheckResult[]): number {
  let weighted = 0;
  let totalWeight = 0;
  for (const c of checks) {
    if (c.score === null || c.weight === 0) continue;
    weighted += c.score * c.weight;
    totalWeight += c.weight;
  }
  if (totalWeight === 0) return 0;
  return Math.round(weighted / totalWeight);
}

/* ───────────────── Proof formatting ──────────────────────────────────── */

function statusIcon(status: CheckStatus): string {
  if (status === "pass") return "✓";
  if (status === "fail") return "✗";
  return "—";
}

export function formatProof(
  proof: VerificationProof,
  opts: { color?: boolean; includePatch?: boolean } = {}
): string {
  const color = opts.color ?? false;
  const c = (fn: (s: string) => string, s: string) => (color ? fn(s) : s);

  const lines: string[] = [];
  const verdictText = proof.verdict === "pass" ? "PASS" : "FAIL";
  lines.push("");
  lines.push(`Verification verdict: ${verdictText}  (score ${proof.overallScore}/100)`);
  lines.push(`Task: ${proof.taskSummary}`);
  lines.push(
    `Diff: ${proof.diffStats.filesChanged} file(s), +${proof.diffStats.insertions} -${proof.diffStats.deletions}`
  );
  lines.push("");
  lines.push("Checks:");
  for (const check of proof.checks) {
    const scoreLabel =
      check.score === null ? "  -" : String(check.score).padStart(3);
    lines.push(
      `  ${statusIcon(check.status)} ${check.name.padEnd(11)} ${scoreLabel}  ${check.summary}`
    );
    if (check.details) {
      const indent = check.details
        .split("\n")
        .map((l) => "      " + l)
        .join("\n");
      lines.push(indent);
    }
  }

  if (opts.includePatch && proof.patch) {
    lines.push("");
    lines.push("Patch:");
    lines.push(proof.patch);
  }

  // Suppress unused-var warning when color disabled.
  void c;

  return lines.join("\n");
}
