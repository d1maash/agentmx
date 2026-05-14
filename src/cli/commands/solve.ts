import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import chalk from "chalk";
import { createAdapters } from "../../adapters/factory.js";
import { ProcessManager } from "../../core/process-manager.js";
import {
  formatProof,
  verifySolution,
  type VerificationProof,
} from "../../core/verifier.js";
import type { Config } from "../../config/schema.js";

export interface SolveOptions {
  agent?: string;
  verify?: boolean;
  noTests?: boolean;
  noLint?: boolean;
  noTypecheck?: boolean;
  /** Where to write proof. Default: <cwd>/.agentmx/last-proof.json + .md. */
  proofOut?: string;
  /** Where to write the patch. Default: <cwd>/.agentmx/last.patch. */
  patchOut?: string;
  /** Verify-only: skip the agent run, verify current working tree. */
  verifyOnly?: boolean;
  /** Per-check timeout (ms). */
  timeout?: string;
  /** Hard cost cap (USD). When reached the agent is killed and verify still runs. */
  maxCost?: string;
}

function isGitRepo(cwd: string): boolean {
  try {
    execSync("git rev-parse --is-inside-work-tree", {
      cwd,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

function workingTreeDirty(cwd: string): boolean {
  try {
    const out = execSync("git status --porcelain", { cwd, encoding: "utf-8" });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

export async function solveCommand(
  task: string,
  options: SolveOptions,
  config: Config
): Promise<void> {
  const cwd = process.cwd();

  if (!isGitRepo(cwd)) {
    console.error(
      chalk.red(
        "amx solve requires a git repository (it diffs HEAD vs working tree to capture the patch)."
      )
    );
    process.exitCode = 1;
    return;
  }

  if (options.verifyOnly) {
    await runVerification(task, options, cwd);
    return;
  }

  const adapters = createAdapters(config);
  const agentName = pickAgent(options.agent, adapters);
  const adapter = adapters.get(agentName);
  if (!adapter) {
    console.error(chalk.red(`Agent "${agentName}" is not enabled or installed.`));
    console.error(
      chalk.dim(`Available: ${[...adapters.keys()].join(", ") || "(none)"}`)
    );
    process.exitCode = 1;
    return;
  }

  if (workingTreeDirty(cwd)) {
    console.log(
      chalk.yellow(
        "⚠  Working tree is dirty. The captured patch will include changes you already made."
      )
    );
  }

  console.log(chalk.bold(`▸ Running ${adapter.info.displayName} on task:`));
  console.log(chalk.dim(`  ${task}`));
  console.log();

  const pm = new ProcessManager(cwd);
  const cleanup = async () => {
    await pm.stopAll();
    process.exit(130);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  const maxCostUsd = parseMaxCost(options.maxCost) ?? config.budgets.hard_stop_per_run;
  if (maxCostUsd) {
    pm.on("budget:hardstop", (info: { cost: number; cap: number }) => {
      console.log(
        chalk.red(`\n[budget] hard-stop hit — cost $${info.cost.toFixed(4)} ≥ cap $${info.cap.toFixed(2)}\n`)
      );
    });
  }

  const sessionId = await pm.start(adapter, task, { cwd, maxCostUsd });
  const proc = pm.get(sessionId);
  if (!proc) {
    console.error(chalk.red(`Failed to start ${adapter.info.name}.`));
    process.exitCode = 1;
    return;
  }

  for await (const chunk of proc.output) {
    process.stdout.write(chunk.data);
  }
  const { exitCode } = await proc.done;
  await pm.stopAll();

  console.log(
    chalk.dim(`\n[${adapter.info.name} exited ${exitCode}]\n`)
  );

  if (options.verify === false) {
    return;
  }

  await runVerification(task, options, cwd);
}

function parseMaxCost(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`--max-cost must be a positive number; got "${raw}"`);
  }
  return n;
}

function pickAgent(
  requested: string | undefined,
  adapters: Map<string, unknown>
): string {
  if (requested && requested !== "auto") return requested;
  // Prefer claude-code if available, else first.
  if (adapters.has("claude-code")) return "claude-code";
  const first = adapters.keys().next();
  return first.done ? "claude-code" : first.value;
}

async function runVerification(
  task: string,
  options: SolveOptions,
  cwd: string
): Promise<void> {
  console.log(chalk.bold("▸ Verifying solution..."));
  const proof = verifySolution({
    cwd,
    task,
    runTests: options.noTests ? false : true,
    runLint: options.noLint ? false : true,
    runTypecheck: options.noTypecheck ? false : true,
    timeoutMs: options.timeout ? parseInt(options.timeout, 10) : undefined,
  });

  printProof(proof);
  writeArtifacts(proof, cwd, options);

  process.exitCode = proof.verdict === "pass" ? 0 : 1;
}

function printProof(proof: VerificationProof): void {
  const verdictColor = proof.verdict === "pass" ? chalk.green : chalk.red;
  const verdictLabel = verdictColor.bold(
    proof.verdict === "pass" ? "PASS" : "FAIL"
  );

  console.log();
  console.log(
    chalk.bold("Verdict: ") +
      verdictLabel +
      chalk.dim(`  (score ${proof.overallScore}/100, ${proof.durationMs}ms)`)
  );
  console.log(chalk.bold("Task:    ") + chalk.dim(proof.taskSummary));
  console.log(
    chalk.bold("Diff:    ") +
      `${proof.diffStats.filesChanged} file(s), ` +
      chalk.green(`+${proof.diffStats.insertions}`) +
      " " +
      chalk.red(`-${proof.diffStats.deletions}`)
  );
  if (proof.diffStats.files.length > 0) {
    for (const f of proof.diffStats.files.slice(0, 12)) {
      console.log(chalk.dim(`         · ${f}`));
    }
    if (proof.diffStats.files.length > 12) {
      console.log(
        chalk.dim(`         · …and ${proof.diffStats.files.length - 12} more`)
      );
    }
  }

  console.log();
  console.log(chalk.bold("Checks:"));
  for (const check of proof.checks) {
    const icon =
      check.status === "pass"
        ? chalk.green("✓")
        : check.status === "fail"
          ? chalk.red("✗")
          : chalk.dim("—");
    const score =
      check.score === null ? chalk.dim("  -") : String(check.score).padStart(3);
    const name = check.name.padEnd(11);
    console.log(`  ${icon} ${chalk.bold(name)} ${chalk.dim(score)}  ${check.summary}`);
    if (check.details) {
      for (const line of check.details.split("\n").slice(0, 12)) {
        console.log(chalk.dim("      " + line));
      }
    }
  }
  console.log();
}

function writeArtifacts(
  proof: VerificationProof,
  cwd: string,
  options: SolveOptions
): void {
  const dir = resolve(cwd, ".agentmx");
  try {
    execSync(`mkdir -p "${dir}"`);
  } catch {
    return;
  }

  const proofJsonPath = options.proofOut
    ? resolve(cwd, options.proofOut)
    : resolve(dir, "last-proof.json");
  const proofMdPath = proofJsonPath.replace(/\.json$/, ".md");
  const patchPath = options.patchOut
    ? resolve(cwd, options.patchOut)
    : resolve(dir, "last.patch");

  try {
    writeFileSync(
      proofJsonPath,
      JSON.stringify({ ...proof, patch: undefined }, null, 2)
    );
    writeFileSync(proofMdPath, formatProof(proof, { includePatch: false }));
    if (proof.patch) {
      writeFileSync(patchPath, proof.patch);
    }
    console.log(
      chalk.dim(
        `Artifacts: ${proofJsonPath}, ${proofMdPath}${proof.patch ? `, ${patchPath}` : ""}`
      )
    );
  } catch (err) {
    console.log(
      chalk.dim(
        `(Could not write artifacts: ${err instanceof Error ? err.message : String(err)})`
      )
    );
  }
}
