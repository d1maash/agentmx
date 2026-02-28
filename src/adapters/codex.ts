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

type CodexJsonItem = {
  id?: string;
  type?: string;
  text?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number | null;
  status?: string;
};

type CodexJsonEvent = {
  type?: string;
  thread_id?: string;
  usage?: {
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
  };
  item?: CodexJsonItem;
};

const COMMAND_OUTPUT_PREVIEW_MAX = 1200;

function ensureTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

function isApprovalLike(value: string): boolean {
  return /(approval|approve|confirm|permission|consent)/i.test(value);
}

function isInputLike(value: string): boolean {
  return /(input|question|prompt|await|wait)/i.test(value);
}

function isPlanLike(value: string): boolean {
  return /plan/i.test(value);
}

function previewCommandOutput(output: string): string {
  const normalized = output.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";
  if (normalized.length <= COMMAND_OUTPUT_PREVIEW_MAX) return normalized;
  const hidden = normalized.length - COMMAND_OUTPUT_PREVIEW_MAX;
  return `${normalized.slice(0, COMMAND_OUTPUT_PREVIEW_MAX)}\n...[${hidden} more chars]`;
}

function formatUsageLine(usage: CodexJsonEvent["usage"]): string {
  if (!usage) return "";
  const inTokens = usage.input_tokens ?? 0;
  const cached = usage.cached_input_tokens ?? 0;
  const outTokens = usage.output_tokens ?? 0;
  return `[codex] Turn complete (in=${inTokens}, cached=${cached}, out=${outTokens})`;
}

interface CodexAdapterConfig {
  defaultArgs?: string[];
  defaultEnv?: Record<string, string>;
}

export class CodexAdapter implements AgentAdapter {
  readonly info: AgentInfo = {
    name: "codex",
    displayName: "Codex CLI",
    description: "OpenAI's coding agent",
    command: "codex",
    isInstalled: false,
  };
  private readonly defaultArgs: string[];
  private readonly defaultEnv: Record<string, string>;

  constructor(config?: CodexAdapterConfig) {
    this.defaultArgs = [...(config?.defaultArgs ?? [])];
    this.defaultEnv = { ...(config?.defaultEnv ?? {}) };
  }

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
    const mergedEnv = {
      ...process.env,
      ...this.defaultEnv,
      ...options?.env,
    } as Record<string, string>;

    // If explicit args are provided, keep raw PTY behavior.
    if (options?.args) {
      return spawnPty({
        command: "codex",
        args: options.args,
        cwd: options.cwd ?? process.cwd(),
        env: mergedEnv,
        agentName: "codex",
        task: task || "interactive",
      });
    }

    if (task && task !== "interactive") {
      // One-shot text mode.
      return spawnPty({
        command: "codex",
        args: [...this.defaultArgs, "exec", task],
        cwd: options?.cwd ?? process.cwd(),
        env: mergedEnv,
        agentName: "codex",
        task,
      });
    }

    // Interactive text bridge (no Codex fullscreen TUI).
    return createCodexTextBridge({
      cwd: options?.cwd ?? process.cwd(),
      env: mergedEnv,
      baseArgs: this.defaultArgs,
    });
  }
}

function createCodexTextBridge(options: {
  cwd: string;
  env: Record<string, string>;
  baseArgs: string[];
}): AgentProcess {
  const { cwd, env, baseArgs } = options;
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
      ? [...baseArgs, "exec", "resume", "--json", threadId, prompt]
      : [...baseArgs, "exec", "--json", prompt];

    const child = spawn("codex", args, { cwd, env, stdio: "pipe" });
    activeChild = child;

    let rawStdout = "";
    let stderr = "";
    let remainder = "";
    let sawJsonEvent = false;
    let sawStructuredOutput = false;
    const nonJsonStdoutLines: string[] = [];
    const notices = {
      approval: false,
      input: false,
      plan: false,
    };

    const emit = (
      text: string,
      type: AgentOutput["type"] = "system"
    ): boolean => {
      if (!text) return false;
      pushOutput(ensureTrailingNewline(text), type);
      return true;
    };

    const maybeEmitNotices = (source: string): boolean => {
      let emitted = false;
      if (!notices.approval && isApprovalLike(source)) {
        emitted =
          emit(
            "[codex] Approval required. Press Enter to focus input, then send your approval or constraints."
          ) || emitted;
        notices.approval = true;
      }
      if (!notices.input && isInputLike(source)) {
        emitted =
          emit(
            "[codex] Waiting for your input. Press Enter to type a reply and submit it."
          ) || emitted;
        notices.input = true;
      }
      if (!notices.plan && isPlanLike(source)) {
        emitted =
          emit(
            "[codex] Plan-related step detected. Review output before approving execution."
          ) || emitted;
        notices.plan = true;
      }
      return emitted;
    };

    const handleEvent = (event: CodexJsonEvent): boolean => {
      const eventType = typeof event.type === "string" ? event.type : "";
      let emitted = false;

      if (eventType === "thread.started" && typeof event.thread_id === "string") {
        threadId = event.thread_id;
        emitted = emit(`[codex] Session started: ${threadId}`) || emitted;
      } else if (eventType === "turn.started") {
        emitted = emit("[codex] Working...") || emitted;
      } else if (eventType === "turn.completed") {
        const usageLine = formatUsageLine(event.usage);
        emitted = emit(usageLine || "[codex] Turn complete.") || emitted;
      }

      const item = event.item;
      if (item && typeof item.type === "string") {
        const itemType = item.type;
        const isStarted = eventType === "item.started";
        const isCompleted = eventType === "item.completed";

        if (itemType === "agent_message" && isCompleted && typeof item.text === "string") {
          emitted = emit(item.text, "stdout") || emitted;
        } else if (itemType === "reasoning" && isCompleted && typeof item.text === "string") {
          emitted = emit(`[codex][reasoning] ${item.text}`) || emitted;
        } else if (itemType === "command_execution") {
          const command =
            typeof item.command === "string" && item.command.length > 0
              ? item.command
              : "<unknown command>";
          if (isStarted) {
            emitted = emit(`[codex][command:start] ${command}`) || emitted;
          } else if (isCompleted) {
            const exitCode =
              typeof item.exit_code === "number" ? item.exit_code : "unknown";
            emitted =
              emit(`[codex][command:end] exit=${exitCode} ${command}`) || emitted;

            if (typeof item.aggregated_output === "string") {
              const preview = previewCommandOutput(item.aggregated_output);
              if (preview) {
                emitted =
                  emit(`[codex][command:output]\n${preview}`, "stdout") || emitted;
              }
            }
          }
        } else if (
          isCompleted &&
          typeof item.text === "string" &&
          item.text.trim().length > 0
        ) {
          emitted = emit(`[codex][${itemType}] ${item.text}`) || emitted;
        }

        const statusSource = `${eventType} ${itemType} ${item.status ?? ""} ${
          typeof item.text === "string" ? item.text : ""
        }`;
        emitted = maybeEmitNotices(statusSource) || emitted;
      } else {
        emitted = maybeEmitNotices(eventType) || emitted;
      }

      if (eventType.includes("failed") || eventType.includes("error")) {
        currentStatus = "error";
      }

      return emitted;
    };

    const processJsonlChunk = (chunk: string, flush = false) => {
      rawStdout += chunk;
      remainder += chunk;

      const parts = remainder.split(/\r?\n/);
      if (!flush) {
        remainder = parts.pop() ?? "";
      } else {
        remainder = "";
      }

      for (const rawLine of parts) {
        const line = rawLine.trim();
        if (!line) continue;
        try {
          const event = JSON.parse(line) as CodexJsonEvent;
          sawJsonEvent = true;
          sawStructuredOutput = handleEvent(event) || sawStructuredOutput;
        } catch {
          nonJsonStdoutLines.push(rawLine);
        }
      }
    };

    child.stdout.on("data", (chunk: Buffer | string) => {
      processJsonlChunk(chunk.toString(), false);
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
      processJsonlChunk("", true);

      const nonJsonStdout = nonJsonStdoutLines.join("\n").trim();

      if (sawStructuredOutput) {
        if (nonJsonStdout.length > 0) {
          pushOutput(ensureTrailingNewline(nonJsonStdout), "stdout");
        }
        if (stderr.trim().length > 0) {
          pushOutput(ensureTrailingNewline(stderr), "stderr");
        }
      } else {
        const stdoutText = sawJsonEvent ? nonJsonStdout : rawStdout;
        const raw = `${stdoutText}${stderr}`.trim();
        if (raw.length > 0) {
          pushOutput(ensureTrailingNewline(raw), code === 0 ? "stdout" : "stderr");
        }
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
