import { ProcessManager } from "../../core/process-manager.js";
import { ReviewPipeline, type ReviewRoles } from "../../core/review-pipeline.js";
import { createAdapters } from "../../adapters/factory.js";
import type { Config } from "../../config/schema.js";
import chalk from "chalk";

interface ReviewOptions {
  coder?: string;
  reviewer?: string;
  tester?: string;
}

const STAGE_LABELS = {
  code: "Coder",
  review: "Reviewer",
  test: "Tester",
} as const;

const STAGE_COLORS = {
  code: chalk.cyan,
  review: chalk.yellow,
  test: chalk.green,
} as const;

export async function reviewCommand(
  task: string,
  options: ReviewOptions,
  config: Config
): Promise<void> {
  const pm = new ProcessManager();
  const adapters = createAdapters(config);

  const cleanup = async () => {
    await pm.stopAll();
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  const defaultAgent = config.default_agent;
  const agentNames = Array.from(adapters.keys());

  // Assign roles (use different agents if available, fallback to default)
  const roles: ReviewRoles = {
    coder: options.coder ?? defaultAgent,
    reviewer: options.reviewer ?? agentNames.find((a) => a !== (options.coder ?? defaultAgent)) ?? defaultAgent,
    tester: options.tester ?? agentNames.find((a) => a !== (options.coder ?? defaultAgent) && a !== (options.reviewer ?? defaultAgent)) ?? defaultAgent,
  };

  // Validate agents exist
  for (const [role, name] of Object.entries(roles)) {
    if (!adapters.has(name)) {
      console.error(
        chalk.red(`Agent "${name}" for role "${role}" not found.`)
      );
      console.error(
        chalk.dim(
          `Available agents: ${agentNames.join(", ")}`
        )
      );
      process.exitCode = 1;
      return;
    }
  }

  console.log(chalk.bold("\nReview Pipeline"));
  console.log(chalk.dim(`  Task: "${task}"`));
  console.log(chalk.cyan(`  Coder:    ${roles.coder}`));
  console.log(chalk.yellow(`  Reviewer: ${roles.reviewer}`));
  console.log(chalk.green(`  Tester:   ${roles.tester}`));
  console.log();

  const pipeline = new ReviewPipeline(roles, pm, adapters);

  try {
    let currentStage = "";

    for await (const event of pipeline.execute(task)) {
      // Print stage header
      if (event.stage !== currentStage) {
        currentStage = event.stage;
        const label = STAGE_LABELS[event.stage];
        const color = STAGE_COLORS[event.stage];
        console.log(
          color(
            chalk.bold(
              `\n═══ Stage: ${label} (${event.agent}) ═══\n`
            )
          )
        );
      }

      // Stream output
      if (event.output) {
        process.stdout.write(event.output.data);
      }

      // Stage completion
      if (event.stageComplete && event.stageResult) {
        const r = event.stageResult;
        const timeStr = (r.durationMs / 1000).toFixed(1) + "s";
        const exitStr =
          r.exitCode === 0
            ? chalk.green("exit 0")
            : chalk.red(`exit ${r.exitCode}`);
        console.log(
          chalk.dim(
            `\n  [${STAGE_LABELS[r.stage]} done: ${timeStr} · ${exitStr}]`
          )
        );
      }

      // Final summary
      if (event.allResults) {
        console.log(chalk.bold("\n\n═══ Review Pipeline Summary ═══\n"));

        let totalTime = 0;
        for (const r of event.allResults) {
          const label = STAGE_LABELS[r.stage];
          const color = STAGE_COLORS[r.stage];
          const timeStr = (r.durationMs / 1000).toFixed(1) + "s";
          const exitStr =
            r.exitCode === 0
              ? chalk.green("✓")
              : chalk.red("✗");

          console.log(
            color(
              `  ${exitStr} ${label.padEnd(10)} ${r.agent.padEnd(15)} ${timeStr}`
            )
          );
          totalTime += r.durationMs;
        }

        console.log(
          chalk.dim(
            `\n  Total time: ${(totalTime / 1000).toFixed(1)}s`
          )
        );
        console.log(chalk.bold.green("\n  Review pipeline completed.\n"));
      }
    }
  } catch (err) {
    console.error(
      chalk.red(
        `\nReview error: ${err instanceof Error ? err.message : err}`
      )
    );
    process.exitCode = 1;
  } finally {
    await pm.stopAll();
  }
}
