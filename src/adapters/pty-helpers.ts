import type { AgentOutput, AgentProcess, AgentStatus } from "./types.js";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pty = require("node-pty");

export interface PtySpawnOptions {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  agentName: string;
  task: string;
}

export function spawnPty(options: PtySpawnOptions): AgentProcess {
  const { command, args, cwd, env, agentName, task } = options;

  let ptyProcess: ReturnType<typeof pty.spawn>;
  try {
    ptyProcess = pty.spawn(command, args, {
      name: "xterm-256color",
      cols: process.stdout.columns || 120,
      rows: process.stdout.rows || 40,
      cwd,
      env,
    });
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to start "${command}": ${msg}. Make sure "${command}" is installed and available in PATH.`
    );
  }

  const buffer: AgentOutput[] = [];
  const emitter = new EventEmitter();
  let currentStatus: AgentStatus = "running";
  let exitResolve: (value: { exitCode: number }) => void;

  const donePromise = new Promise<{ exitCode: number }>((resolve) => {
    exitResolve = resolve;
  });

  ptyProcess.onData((data: string) => {
    const output: AgentOutput = {
      type: "stdout",
      data,
      timestamp: Date.now(),
    };
    buffer.push(output);
    emitter.emit("output", output);
  });

  ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
    currentStatus = exitCode === 0 ? "done" : "error";
    emitter.emit("exit", exitCode);
    exitResolve({ exitCode });
  });

  const outputIterable: AsyncIterable<AgentOutput> = {
    [Symbol.asyncIterator]() {
      const queue: AgentOutput[] = [];
      let resolve: ((value: IteratorResult<AgentOutput>) => void) | null =
        null;
      let done = false;

      emitter.on("output", (output: AgentOutput) => {
        if (resolve) {
          const r = resolve;
          resolve = null;
          r({ value: output, done: false });
        } else {
          queue.push(output);
        }
      });

      emitter.on("exit", () => {
        done = true;
        if (resolve) {
          const r = resolve;
          resolve = null;
          r({ value: undefined as unknown as AgentOutput, done: true });
        }
      });

      return {
        next(): Promise<IteratorResult<AgentOutput>> {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift()!, done: false });
          }
          if (done) {
            return Promise.resolve({
              value: undefined as unknown as AgentOutput,
              done: true,
            });
          }
          return new Promise((r) => {
            resolve = r;
          });
        },
      };
    },
  };

  return {
    send(input: string) {
      ptyProcess.write(input);
    },
    output: outputIterable,
    get status() {
      return currentStatus;
    },
    set status(s: AgentStatus) {
      currentStatus = s;
    },
    buffer,
    async kill() {
      try {
        const treeKill = (await import("tree-kill")).default;
        await new Promise<void>((resolve, reject) => {
          treeKill(ptyProcess.pid, "SIGTERM", (err?: Error) => {
            if (err) reject(err);
            else resolve();
          });
        });
      } catch {
        ptyProcess.kill();
      }
    },
    done: donePromise,
    task,
    agentName,
  };
}
