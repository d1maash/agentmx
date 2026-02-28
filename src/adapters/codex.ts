import type {
  AgentAdapter,
  AgentProcess,
  AgentInfo,
  AgentOutput,
  AgentStatus,
  SpawnOptions,
} from "./types.js";
import { execSync } from "node:child_process";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { spawnPty } from "./pty-helpers.js";

export class CodexAdapter implements AgentAdapter {
  readonly info: AgentInfo = {
    name: "codex",
    displayName: "Codex CLI",
    description: "OpenAI's coding agent",
    command: "codex",
    isInstalled: false,
  };

  async checkInstalled(): Promise<boolean> {
    try {
      execSync("which codex", { stdio: "ignore" });
      this.info.isInstalled = true;
      return true;
    } catch {
      this.info.isInstalled = false;
      return false;
    }
  }

  spawn(task: string, options?: SpawnOptions): AgentProcess {
    // If explicit args are provided, keep raw PTY behavior.
    if (options?.args) {
      return spawnPty({
        command: "codex",
        args: options.args,
        cwd: options.cwd ?? process.cwd(),
        env: { ...process.env, ...options.env } as Record<string, string>,
        agentName: "codex",
        task: task || "interactive",
      });
    }

    if (task && task !== "interactive") {
      // One-shot text mode.
      return spawnPty({
        command: "codex",
        args: ["exec", task],
        cwd: options?.cwd ?? process.cwd(),
        env: { ...process.env, ...options?.env } as Record<string, string>,
        agentName: "codex",
        task,
      });
    }

    // Interactive text bridge (no Codex fullscreen TUI).
    return createCodexTextBridge({
      cwd: options?.cwd ?? process.cwd(),
      env: { ...process.env, ...options?.env } as Record<string, string>,
    });
  }
}

function createCodexTextBridge(options: {
  cwd: string;
  env: Record<string, string>;
}): AgentProcess {
  const { cwd, env } = options;
  const emitter = new EventEmitter();
  const buffer: AgentOutput[] = [];
  const queue: string[] = [];

  let currentStatus: AgentStatus = "idle";
  let activeChild: ReturnType<typeof spawn> | null = null;
  let pendingInput = "";
  let threadId: string | null = null;
  let stopped = false;
  let processing = false;
  let doneResolved = false;
  let resolveDone!: (value: { exitCode: number }) => void;

  const done = new Promise<{ exitCode: number }>((resolve) => {
    resolveDone = resolve;
  });

  const resolveExit = (exitCode: number) => {
    if (doneResolved) return;
    doneResolved = true;
    emitter.emit("exit", exitCode);
    resolveDone({ exitCode });
  };

  const pushOutput = (data: string, type: AgentOutput["type"] = "stdout") => {
    if (!data) return;
    const out: AgentOutput = { type, data, timestamp: Date.now() };
    buffer.push(out);
    emitter.emit("output", out);
    emitter.emit("data", data);
  };

  const runNext = () => {
    if (stopped || processing) return;

    const prompt = queue.shift();
    if (!prompt) {
      currentStatus = "idle";
      return;
    }

    processing = true;
    currentStatus = "running";

    const args = threadId
      ? ["exec", "resume", "--json", threadId, prompt]
      : ["exec", "--json", prompt];

    const child = spawn("codex", args, { cwd, env, stdio: "pipe" });
    activeChild = child;

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      pushOutput(`Codex launch error: ${err.message}\n`, "stderr");
      activeChild = null;
      processing = false;
      currentStatus = "error";
      runNext();
    });

    child.on("close", (code) => {
      activeChild = null;
      processing = false;

      const messages: string[] = [];
      const lines = stdout.split(/\r?\n/).filter((line) => line.trim().length > 0);

      for (const line of lines) {
        try {
          const event = JSON.parse(line) as {
            type?: string;
            thread_id?: string;
            item?: { type?: string; text?: string };
          };

          if (event.type === "thread.started" && typeof event.thread_id === "string") {
            threadId = event.thread_id;
          }

          if (event.type === "item.completed" && event.item?.type === "agent_message") {
            if (typeof event.item.text === "string" && event.item.text.length > 0) {
              messages.push(event.item.text);
            }
          }
        } catch {
          // Ignore malformed jsonl line; raw output fallback below handles it.
        }
      }

      if (messages.length > 0) {
        const text = `${messages.join("\n")}\n`;
        pushOutput(text, "stdout");
      } else {
        const raw = `${stdout}${stderr}`.trim();
        if (raw.length > 0) {
          pushOutput(raw.endsWith("\n") ? raw : `${raw}\n`, code === 0 ? "stdout" : "stderr");
        }
      }

      if (stderr.trim().length > 0 && messages.length > 0) {
        pushOutput(stderr.endsWith("\n") ? stderr : `${stderr}\n`, "stderr");
      }

      if (code && code !== 0) {
        currentStatus = "error";
      }

      if (stopped) {
        currentStatus = "done";
        resolveExit(code ?? 0);
        return;
      }

      runNext();
    });
  };

  const output: AsyncIterable<AgentOutput> = {
    [Symbol.asyncIterator]() {
      const localQueue: AgentOutput[] = [];
      let resolve: ((value: IteratorResult<AgentOutput>) => void) | null = null;
      let isDone = false;

      const onOutput = (out: AgentOutput) => {
        if (resolve) {
          const r = resolve;
          resolve = null;
          r({ value: out, done: false });
        } else {
          localQueue.push(out);
        }
      };

      const onExit = () => {
        isDone = true;
        if (resolve) {
          const r = resolve;
          resolve = null;
          r({ value: undefined as unknown as AgentOutput, done: true });
        }
      };

      emitter.on("output", onOutput);
      emitter.on("exit", onExit);

      return {
        next(): Promise<IteratorResult<AgentOutput>> {
          if (localQueue.length > 0) {
            return Promise.resolve({ value: localQueue.shift()!, done: false });
          }
          if (isDone) {
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
      if (stopped) return;

      pendingInput += input;
      const lines = pendingInput.split(/\r?\n/);
      pendingInput = lines.pop() ?? "";

      for (const line of lines) {
        const prompt = line.trim();
        if (!prompt) continue;
        queue.push(prompt);
      }

      runNext();
    },
    output,
    get status() {
      return currentStatus;
    },
    set status(s: AgentStatus) {
      currentStatus = s;
    },
    buffer,
    async kill() {
      stopped = true;
      queue.length = 0;

      if (activeChild && !activeChild.killed) {
        activeChild.kill("SIGTERM");
        setTimeout(() => {
          if (activeChild && !activeChild.killed) {
            activeChild.kill("SIGKILL");
          }
        }, 2000);
      } else {
        currentStatus = "done";
        resolveExit(0);
      }
    },
    done,
    task: "interactive",
    agentName: "codex",
    onData(listener: (data: string) => void): () => void {
      emitter.on("data", listener);
      return () => emitter.off("data", listener);
    },
    resize() {
      // No-op for text bridge mode.
    },
  };
}
