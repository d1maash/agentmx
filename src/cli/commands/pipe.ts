import { ProcessManager } from "../../core/process-manager.js";
import { Pipeline, parsePipelineSteps } from "../../core/pipeline.js";
import { ClaudeCodeAdapter } from "../../adapters/claude-code.js";
import { CodexAdapter } from "../../adapters/codex.js";
import { AiderAdapter } from "../../adapters/aider.js";
import { CustomAdapter } from "../../adapters/custom.js";
import type { AgentAdapter } from "../../adapters/types.js";
import type { Config } from "../../config/schema.js";
import chalk from "chalk";

function createAdaptersMap(config: Config): Map<string, AgentAdapter> {
  const adapters = new Map<string, AgentAdapter>();

  for (const [name, agentConfig] of Object.entries(config.agents)) {
    if (!agentConfig.enabled) continue;

    let adapter: AgentAdapter;
    switch (name) {
      case "claude-code":
        adapter = new ClaudeCodeAdapter();
        break;
      case "codex":
        adapter = new CodexAdapter({
          defaultArgs: agentConfig.args,
          defaultEnv: agentConfig.env,
        });
        break;
      case "aider":
        adapter = new AiderAdapter();
        break;
      default:
        adapter = new CustomAdapter({
          name,
          command: agentConfig.command,
          defaultArgs: agentConfig.args,
          env: agentConfig.env,
        });
    }
    adapters.set(name, adapter);
  }

  return adapters;
}

export async function pipeCommand(
  steps: string[],
  config: Config
): Promise<void> {
  const pm = new ProcessManager();
  const adapters = createAdaptersMap(config);

  // Graceful shutdown
  const cleanup = async () => {
    await pm.stopAll();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  try {
    const pipelineSteps = parsePipelineSteps(steps);

    console.log(chalk.bold("\nPipeline:"));
    pipelineSteps.forEach((step, i) => {
      console.log(chalk.dim(`  ${i + 1}. [${step.agent}] ${step.task}`));
    });
    console.log();

    const pipeline = new Pipeline(pipelineSteps, pm, adapters);

    let currentStep = -1;
    for await (const { step, agent, output } of pipeline.execute()) {
      if (step !== currentStep) {
        currentStep = step;
        console.log(
          chalk.bold.cyan(`\n--- Step ${step + 1}: ${agent} ---\n`)
        );
      }
      process.stdout.write(output.data);
    }

    console.log(chalk.bold.green("\n\nPipeline completed."));
  } catch (err) {
    console.error(
      chalk.red(`\nPipeline error: ${err instanceof Error ? err.message : err}`)
    );
    process.exitCode = 1;
  } finally {
    await pm.stopAll();
  }
}
