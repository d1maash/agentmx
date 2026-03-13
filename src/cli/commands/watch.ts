import chalk from "chalk";
import { relative, resolve } from "node:path";
import type { AgentAdapter } from "../../adapters/types.js";
import { createAdapters } from "../../adapters/factory.js";
import type { Config } from "../../config/schema.js";
import { ProcessManager } from "../../core/process-manager.js";
import { watchWorkspace } from "../../core/workspace-watcher.js";
import {
  printRunTargetError,
  resolveRunTargets,
  type RunTargetOptions,
} from "./run-targets.js";

interface WatchOptions extends RunTargetOptions {
  debounce?: string;
}

interface RunResult {
  runNumber: number;
  durationMs: number;
  interrupted: boolean;
  failed: boolean;
  exitCodes: Array<{ agentName: string; exitCode: number }>;
}

const DEFAULT_DEBOUNCE_MS = 500;
const PREFIX_COLORS = [
  chalk.cyan,
  chalk.yellow,
  chalk.green,
  chalk.magenta,
  chalk.blue,
  chalk.red,
];

export function summarizeChangedPaths(paths: string[], maxItems = 3): string {
  const unique = Array.from(new Set(paths));
  if (unique.length === 0) {
    return "manual restart";
  }

  if (unique.length <= maxItems) {
    return unique.join(", ");
  }

  const visible = unique.slice(0, maxItems).join(", ");
  const remaining = unique.length - maxItems;
  return `${visible} +${remaining} more`;
}

export function splitOutputForPrefix(
  pending: string,
  chunk: string
): { flushed: string[]; pending: string } {
  const normalized = `${pending}${chunk}`
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const parts = normalized.split("\n");

  return {
    flushed: parts.slice(0, -1),
    pending: parts[parts.length - 1] ?? "",
  };
}

export async function watchCommand(
  task: string,
  options: WatchOptions,
  config: Config
): Promise<void> {
  const adapters = createAdapters(config);
  const availableAgents = Array.from(adapters.keys());

  let targets;
  try {
    targets = await resolveRunTargets(task, options, config, availableAgents);
  } catch (err) {
    printRunTargetError(err, availableAgents);
    process.exitCode = 1;
    return;
  }

  const debounceMs = parseDebounce(options.debounce);
  if (debounceMs === null) {
    console.error(
      chalk.red("Debounce must be a non-negative integer in milliseconds.")
    );
    process.exitCode = 1;
    return;
  }

  const agentNames = targets.parallelAgents ?? [targets.initialAgent!];
  const pm = new ProcessManager(process.cwd());
  const interruptedRuns = new Set<number>();
  const pendingChanges = new Set<string>();
  const workspaceRoot = process.cwd();

  let watcher: Awaited<ReturnType<typeof watchWorkspace>> | null = null;
  let debounceTimer: NodeJS.Timeout | null = null;
  let closed = false;
  let draining = false;
  let needsRun = false;
  let currentRunNumber = 0;

  const cleanup = async () => {
    if (closed) return;
    closed = true;

    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    if (watcher) {
      await watcher.close();
      watcher = null;
    }

    await pm.stopAll();
  };

  process.on("SIGINT", async () => {
    await cleanup();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await cleanup();
    process.exit(0);
  });

  const drainRuns = async () => {
    if (draining || closed) return;
    draining = true;

    try {
      while (needsRun && !closed) {
        needsRun = false;
        const changedPaths = Array.from(pendingChanges);
        pendingChanges.clear();

        const result = await runWatchIteration(
          task,
          agentNames,
          adapters,
          pm,
          changedPaths,
          ++currentRunNumber,
          interruptedRuns
        );

        if (closed) return;

        const summary = result.exitCodes
          .map(({ agentName, exitCode }) =>
            `${agentName} ${
              exitCode === 0
                ? chalk.green("exit 0")
                : chalk.red(`exit ${exitCode}`)
            }`
          )
          .join(chalk.dim(" | "));

        if (result.interrupted) {
          console.log(
            chalk.yellow(
              `\n[watch] Run #${result.runNumber} interrupted after ${formatDuration(
                result.durationMs
              )}`
            )
          );
        } else if (result.failed) {
          console.log(
            chalk.red(
              `\n[watch] Run #${result.runNumber} failed after ${formatDuration(
                result.durationMs
              )}`
            )
          );
        } else {
          console.log(
            chalk.green(
              `\n[watch] Run #${result.runNumber} completed in ${formatDuration(
                result.durationMs
              )}`
            )
          );
        }

        if (summary) {
          console.log(summary);
        }

        if (!needsRun && !closed) {
          console.log(chalk.dim("\n[watch] Waiting for changes...\n"));
        }
      }
    } finally {
      draining = false;
    }
  };

  const scheduleRestart = (changedPath: string) => {
    pendingChanges.add(relativeToCwd(changedPath));

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      needsRun = true;

      if (draining && currentRunNumber > 0) {
        interruptedRuns.add(currentRunNumber);
        void pm.stopAll();
      }

      console.log(
        chalk.dim(
          `[watch] Change detected: ${summarizeChangedPaths(
            Array.from(pendingChanges)
          )}`
        )
      );

      void drainRuns();
    }, debounceMs);
  };

  console.log(chalk.bold("\nWatch Mode"));
  console.log(chalk.dim(`  Task: "${task}"`));
  console.log(chalk.dim(`  Agents: ${agentNames.join(", ")}`));
  console.log(chalk.dim(`  Watching: ${workspaceRoot}`));
  console.log(chalk.dim(`  Debounce: ${debounceMs}ms`));
  console.log();

  watcher = await watchWorkspace(workspaceRoot, scheduleRestart);

  needsRun = true;
  await drainRuns();
}

async function runWatchIteration(
  task: string,
  agentNames: string[],
  adapters: Map<string, AgentAdapter>,
  pm: ProcessManager,
  changedPaths: string[],
  runNumber: number,
  interruptedRuns: Set<number>
): Promise<RunResult> {
  const startTime = Date.now();
  const triggerLabel =
    changedPaths.length === 0
      ? "initial run"
      : `changes in ${summarizeChangedPaths(changedPaths)}`;

  console.log(chalk.bold.cyan(`\n[watch] Run #${runNumber}`));
  console.log(chalk.dim(`  Trigger: ${triggerLabel}`));
  console.log(chalk.dim(`  Started: ${new Date().toLocaleTimeString()}`));
  console.log();

  await pm.stopAll();

  const exitCodes: Array<{ agentName: string; exitCode: number }> = [];
  const outputPromises: Promise<void>[] = [];
  let failed = false;

  try {
    const sessions = await Promise.all(
      agentNames.map(async (agentName) => {
        const adapter = adapters.get(agentName);
        if (!adapter) {
          throw new Error(`Agent "${agentName}" is not configured.`);
        }

        const sessionId = await pm.start(adapter, task);
        const proc = pm.get(sessionId);
        if (!proc) {
          throw new Error(`Failed to start ${agentName}.`);
        }

        return { agentName, proc };
      })
    );

    const prefixed = sessions.length > 1;

    for (let index = 0; index < sessions.length; index++) {
      const { proc, agentName } = sessions[index];
      const prefix = PREFIX_COLORS[index % PREFIX_COLORS.length](
        `[${agentName}]`
      );
      const writer = prefixed ? createPrefixedWriter(prefix) : null;

      outputPromises.push(
        (async () => {
          for await (const chunk of proc.output) {
            if (writer) {
              writer.write(chunk.data);
            } else {
              process.stdout.write(chunk.data);
            }
          }

          writer?.flush();
        })()
      );
    }

    await Promise.all(
      sessions.map(async ({ agentName, proc }) => {
        const { exitCode } = await proc.done;
        exitCodes.push({ agentName, exitCode });
      })
    );

    await Promise.all(outputPromises);
  } catch (err) {
    failed = true;
    await pm.stopAll();
    await Promise.allSettled(outputPromises);
    console.error(
      chalk.red(
        `\n[watch] ${err instanceof Error ? err.message : String(err)}`
      )
    );
  }

  const interrupted = interruptedRuns.has(runNumber);
  interruptedRuns.delete(runNumber);

  return {
    runNumber,
    durationMs: Date.now() - startTime,
    interrupted,
    failed,
    exitCodes,
  };
}

function createPrefixedWriter(prefix: string): {
  write(chunk: string): void;
  flush(): void;
} {
  let pending = "";

  return {
    write(chunk: string) {
      const next = splitOutputForPrefix(pending, chunk);
      pending = next.pending;

      for (const line of next.flushed) {
        process.stdout.write(`${prefix} ${line}\n`);
      }
    },
    flush() {
      if (!pending) return;
      process.stdout.write(`${prefix} ${pending}\n`);
      pending = "";
    },
  };
}

function parseDebounce(value?: string): number | null {
  if (!value) return DEFAULT_DEBOUNCE_MS;
  if (!/^\d+$/.test(value)) return null;
  return Number.parseInt(value, 10);
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  return `${(ms / 1000).toFixed(1)}s`;
}

function relativeToCwd(targetPath: string): string {
  const relativePath = relative(process.cwd(), resolve(targetPath));

  if (
    relativePath.length === 0 ||
    relativePath === "." ||
    relativePath.startsWith("..")
  ) {
    return ".";
  }

  return relativePath;
}
