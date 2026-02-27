import type {
  AgentAdapter,
  AgentProcess,
  AgentOutput,
  AgentInfo,
  SpawnOptions,
  AgentStatus,
} from "./types.js";
import { execSync } from "node:child_process";
import { EventEmitter } from "node:events";

export class AiderAdapter implements AgentAdapter {
  readonly info: AgentInfo = {
    name: "aider",
    displayName: "Aider",
    description: "Git-integrated AI coding assistant",
    command: "aider",
    isInstalled: false,
  };

  async checkInstalled(): Promise<boolean> {
    try {
      execSync("which aider", { stdio: "ignore" });
      this.info.isInstalled = true;
      return true;
    } catch {
      this.info.isInstalled = false;
      return false;
    }
  }

  spawn(task: string, options?: SpawnOptions): AgentProcess {
    const pty = require("node-pty");

    const args = options?.args ?? ["--message", task];
    const cwd = options?.cwd ?? process.cwd();
    const env = { ...process.env, ...options?.env } as Record<string, string>;

    const ptyProcess = pty.spawn("aider", args, {
      name: "xterm-256color",
      cols: 120,
      rows: 40,
      cwd,
      env,
    });

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
      agentName: "aider",
    };
  }
}
