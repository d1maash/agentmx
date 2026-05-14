import { ProcessManager } from "../../core/process-manager.js";
import { createAdapters } from "../../adapters/factory.js";
import {
  PRFactory,
  type PRFactoryRoles,
  type PRFactoryStage,
} from "../../core/pr-factory.js";
import { checkGhInstalled } from "../../core/github.js";
import type { Config } from "../../config/schema.js";
import chalk from "chalk";

const STAGE_LABELS: Record<PRFactoryStage, string> = {
  "fetch-issue": "Issue",
  code: "Coder",
  test: "Tester",
  "commit-push": "Git",
  "open-pr": "PR",
  review: "Reviewer",
  "ci-watch": "CI",
  "ci-fix": "CI Fix",
};

const STAGE_COLORS: Record<PRFactoryStage, (s: string) => string> = {
  "fetch-issue": chalk.blue,
  code: chalk.cyan,
  test: chalk.green,
  "commit-push": chalk.magenta,
  "open-pr": chalk.bold.blue,
  review: chalk.yellow,
  "ci-watch": chalk.gray,
  "ci-fix": chalk.red,
};

export interface PRFactoryCliOptions {
  coder?: string;
  reviewer?: string;
  tester?: string;
  noTester?: boolean;
  base?: string;
  branch?: string;
  draft?: boolean;
  noCi?: boolean;
  ciTimeout?: string;
  ciRounds?: string;
  /** Hard cost cap per stage in USD. Stage agent is killed if reached. */
  maxCost?: string;
}

export async function prFactoryCommand(
  issueRef: string,
  options: PRFactoryCliOptions,
  config: Config
): Promise<void> {
  if (!(await checkGhInstalled())) {
    console.error(
      chalk.red(
        'GitHub CLI ("gh") is not installed. Install it from https://cli.github.com/ and run "gh auth login".'
      )
    );
    process.exitCode = 1;
    return;
  }

  const pm = new ProcessManager();
  const adapters = createAdapters(config);
  const agentNames = Array.from(adapters.keys());

  if (agentNames.length === 0) {
    console.error(
      chalk.red(
        'No agents enabled in config. Run "amx init" or enable an agent in .agentmx.yml.'
      )
    );
    process.exitCode = 1;
    return;
  }

  const cleanup = async () => {
    await pm.stopAll();
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  const defaultAgent = config.default_agent;
  const coder = options.coder ?? defaultAgent;
  const reviewer =
    options.reviewer ?? agentNames.find((a) => a !== coder) ?? defaultAgent;
  const tester = options.noTester
    ? undefined
    : options.tester ??
      agentNames.find((a) => a !== coder && a !== reviewer);

  const roles: PRFactoryRoles = { coder, reviewer, tester };

  for (const [role, name] of Object.entries(roles)) {
    if (!name) continue;
    if (!adapters.has(name)) {
      console.error(
        chalk.red(`Agent "${name}" for role "${role}" not enabled.`)
      );
      console.error(chalk.dim(`Available agents: ${agentNames.join(", ")}`));
      process.exitCode = 1;
      return;
    }
  }

  console.log(chalk.bold("\nPR Factory"));
  console.log(chalk.dim(`  Issue: ${issueRef}`));
  console.log(chalk.cyan(`  Coder:    ${coder}`));
  if (tester) console.log(chalk.green(`  Tester:   ${tester}`));
  console.log(chalk.yellow(`  Reviewer: ${reviewer}`));
  console.log(chalk.dim(`  Base:     ${options.base ?? "main"}`));
  console.log();

  const factory = new PRFactory(roles, pm, adapters);

  let currentStage: PRFactoryStage | "" = "";
  try {
    for await (const event of factory.execute(issueRef, {
      base: options.base ?? "main",
      cwd: process.cwd(),
      branch: options.branch,
      draft: options.draft,
      watchCi: !options.noCi,
      maxCiRounds: options.ciRounds ? Number(options.ciRounds) : 1,
      ciTimeoutMs: options.ciTimeout
        ? Number(options.ciTimeout) * 1000
        : undefined,
    })) {
      if (event.stage !== currentStage) {
        currentStage = event.stage;
        const label = STAGE_LABELS[event.stage];
        const color = STAGE_COLORS[event.stage];
        const who = event.agent ? ` (${event.agent})` : "";
        console.log(color(chalk.bold(`\n═══ ${label}${who} ═══\n`)));
      }

      if (event.info) {
        console.log(chalk.dim(`  · ${event.info}`));
      }

      if (event.output) {
        process.stdout.write(event.output.data);
      }

      if (event.stageComplete && event.stageResult) {
        const r = event.stageResult;
        const time = (r.durationMs / 1000).toFixed(1) + "s";
        const exit =
          r.exitCode === 0
            ? chalk.green("ok")
            : chalk.red(`exit ${r.exitCode}`);
        console.log(chalk.dim(`\n  [${STAGE_LABELS[r.stage]} done · ${time} · ${exit}]`));
      }

      if (event.allResults) {
        console.log(chalk.bold("\n\n═══ PR Factory Summary ═══\n"));
        let total = 0;
        for (const r of event.allResults) {
          const label = STAGE_LABELS[r.stage];
          const color = STAGE_COLORS[r.stage];
          const time = (r.durationMs / 1000).toFixed(1) + "s";
          const mark = r.exitCode === 0 ? chalk.green("✓") : chalk.red("✗");
          const who = r.agent ? r.agent : "—";
          console.log(
            color(`  ${mark} ${label.padEnd(14)} ${who.padEnd(15)} ${time}`)
          );
          total += r.durationMs;
        }
        if (event.pr) {
          console.log(chalk.bold.blue(`\n  PR: ${event.pr.url}`));
        }
        if (event.checks) {
          const ok = !event.checks.anyFailed;
          console.log(
            (ok ? chalk.green : chalk.red)(
              `  CI: ${ok ? "passing" : "failing"} (${event.checks.passed.length} passed, ${event.checks.failed.length} failed, ${event.checks.pending.length} pending)`
            )
          );
        }
        console.log(chalk.dim(`\n  Total time: ${(total / 1000).toFixed(1)}s\n`));
      }
    }
  } catch (err) {
    console.error(
      chalk.red(`\nPR Factory error: ${err instanceof Error ? err.message : err}`)
    );
    process.exitCode = 1;
  } finally {
    await pm.stopAll();
  }
}
