import type {
  AgentAdapter,
  AgentProcess,
  AgentInfo,
  AgentOutput,
  AgentStatus,
  ClaudeActivity,
  SpawnOptions,
} from "./types.js";
import { execSync } from "node:child_process";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { spawnPty } from "./pty-helpers.js";

/**
 * Build a clean env for spawning Claude sub-processes.
 * Removes variables that prevent nested Claude Code sessions.
 */
function cleanClaudeEnv(extra?: Record<string, string>): Record<string, string> {
  const { CLAUDECODE, CLAUDE_CODE, ...rest } = process.env as Record<string, string>;
  return { ...rest, ...extra };
}

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly info: AgentInfo = {
    name: "claude-code",
    displayName: "Claude Code",
    description: "Anthropic's AI coding agent",
    command: "claude",
    isInstalled: false,
  };

  async checkInstalled(): Promise<boolean> {
    try {
      execSync("which claude", { stdio: "ignore" });
      this.info.isInstalled = true;
      return true;
    } catch {
      this.info.isInstalled = false;
      return false;
    }
  }

  spawn(task: string, options?: SpawnOptions): AgentProcess {
    const env = cleanClaudeEnv(options?.env);

    // If explicit args provided, use raw PTY mode directly.
    let args: string[];
    if (options?.args) {
      args = options.args;
      return spawnPty({
        command: "claude",
        args,
        cwd: options.cwd ?? process.cwd(),
        env,
        agentName: "claude-code",
        task: task || "interactive",
      });
    }

    if (task && task !== "interactive") {
      // One-shot task mode — structured stream-json output.
      return createClaudeStreamJson({
        task,
        cwd: options?.cwd ?? process.cwd(),
        env,
      });
    }

    // Interactive text bridge (no fullscreen Claude UI).
    return createClaudeTextBridge({
      cwd: options?.cwd ?? process.cwd(),
      env,
    });
  }
}

/** Format a tool call into a human-readable summary */
function formatToolCall(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "Read":
      return `[Read] ${input.file_path ?? ""}`;
    case "Write":
      return `[Write] ${input.file_path ?? ""}`;
    case "Edit":
      return `[Edit] ${input.file_path ?? ""}`;
    case "Bash":
      return `[Bash] ${truncate(String(input.command ?? ""), 80)}`;
    case "Glob":
      return `[Glob] ${input.pattern ?? ""}`;
    case "Grep":
      return `[Grep] ${input.pattern ?? ""}`;
    case "WebSearch":
      return `[WebSearch] ${input.query ?? ""}`;
    case "WebFetch":
      return `[WebFetch] ${input.url ?? ""}`;
    case "Task":
      return `[Task] ${truncate(String(input.description ?? input.prompt ?? ""), 60)}`;
    default:
      return `[${name}]`;
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** Process a stream-json event into AgentOutput with activity metadata */
function processStreamEvent(event: Record<string, unknown>): AgentOutput[] {
  const outputs: AgentOutput[] = [];
  const ts = Date.now();

  const type = event.type as string | undefined;
  const subtype = event.subtype as string | undefined;

  if (type === "system" && subtype === "init") {
    const model = String(event.model ?? "unknown");
    const sessionId = String(event.session_id ?? "");
    const tools = Array.isArray(event.tools) ? (event.tools as string[]) : [];
    const activity: ClaudeActivity = { kind: "init", model, sessionId, tools };
    outputs.push({
      type: "system",
      data: `Session started · model: ${model}\n`,
      timestamp: ts,
      activity,
    });
    return outputs;
  }

  if (type === "assistant") {
    const message = event.message as { content?: Array<Record<string, unknown>> } | undefined;
    if (message?.content && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === "text" && typeof block.text === "string") {
          outputs.push({
            type: "stdout",
            data: (block.text as string).endsWith("\n") ? (block.text as string) : `${block.text}\n`,
            timestamp: ts,
            activity: { kind: "text", text: block.text as string },
          });
        } else if (block.type === "tool_use") {
          const toolName = String(block.name ?? "unknown");
          const toolId = String(block.id ?? "");
          const input = (block.input as Record<string, unknown>) ?? {};
          const summary = formatToolCall(toolName, input);
          outputs.push({
            type: "stdout",
            data: `${summary}\n`,
            timestamp: ts,
            activity: { kind: "tool_call", toolName, toolId, input },
          });
        }
      }
    }
    return outputs;
  }

  if (type === "user") {
    const message = event.message as { content?: Array<Record<string, unknown>> } | undefined;
    if (message?.content && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === "tool_result") {
          const toolId = String(block.tool_use_id ?? "");
          const rawContent = block.content;
          let text: string;
          if (typeof rawContent === "string") {
            text = rawContent;
          } else if (Array.isArray(rawContent)) {
            text = rawContent
              .filter((c: Record<string, unknown>) => c.type === "text")
              .map((c: Record<string, unknown>) => c.text)
              .join("\n");
          } else {
            text = "";
          }
          const abbreviated = truncate(text.replace(/\n/g, " "), 120);
          const isError = block.is_error === true;
          outputs.push({
            type: "stdout",
            data: `  → ${abbreviated}\n`,
            timestamp: ts,
            activity: { kind: "tool_result", toolId, content: text, isError },
          });
        }
      }
    }
    return outputs;
  }

  if (type === "result") {
    const totalCost = Number(event.total_cost_usd ?? 0);
    const durationMs = Number(event.duration_ms ?? 0);
    const usage = event.usage as Record<string, unknown> | undefined;
    const durationSec = (durationMs / 1000).toFixed(1);
    outputs.push({
      type: "system",
      data: `Done · $${totalCost.toFixed(4)} · ${durationSec}s\n`,
      timestamp: ts,
      activity: { kind: "cost", totalCost, durationMs, usage },
    });

    // Also extract result text if present
    if (typeof event.result === "string" && (event.result as string).length > 0) {
      outputs.push({
        type: "stdout",
        data: (event.result as string).endsWith("\n") ? (event.result as string) : `${event.result}\n`,
        timestamp: ts,
        activity: { kind: "text", text: event.result as string },
      });
    }

    return outputs;
  }

  return outputs;
}

/** Spawn Claude in one-shot task mode with structured stream-json output */
function createClaudeStreamJson(options: {
  task: string;
  cwd: string;
  env: Record<string, string>;
}): AgentProcess {
  const { task, cwd, env } = options;
  const emitter = new EventEmitter();
  const buffer: AgentOutput[] = [];
  let currentStatus: AgentStatus = "spawning";
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

  const pushOutput = (out: AgentOutput) => {
    buffer.push(out);
    emitter.emit("output", out);
    emitter.emit("data", out.data);
  };

  const args = ["-p", "--output-format", "stream-json", "--verbose", task];
  const child = spawn("claude", args, { cwd, env, stdio: "pipe" });
  currentStatus = "running";

  let lineBuf = "";
  let stderr = "";

  child.stdout.on("data", (chunk: Buffer | string) => {
    lineBuf += chunk.toString();
    const lines = lineBuf.split("\n");
    lineBuf = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event = JSON.parse(trimmed) as Record<string, unknown>;
        const outputs = processStreamEvent(event);
        for (const out of outputs) {
          pushOutput(out);
        }
      } catch {
        pushOutput({ type: "stdout", data: `${trimmed}\n`, timestamp: Date.now() });
      }
    }
  });

  child.stderr.on("data", (chunk: Buffer | string) => {
    stderr += chunk.toString();
  });

  child.on("error", (err) => {
    pushOutput({
      type: "stderr",
      data: `Claude launch error: ${err.message}\n`,
      timestamp: Date.now(),
    });
    currentStatus = "error";
    resolveExit(1);
  });

  child.on("close", (code) => {
    // Process remaining line buffer
    if (lineBuf.trim()) {
      try {
        const event = JSON.parse(lineBuf.trim()) as Record<string, unknown>;
        const outputs = processStreamEvent(event);
        for (const out of outputs) {
          pushOutput(out);
        }
      } catch {
        pushOutput({ type: "stdout", data: `${lineBuf.trim()}\n`, timestamp: Date.now() });
      }
    }

    if (stderr.trim()) {
      pushOutput({ type: "stderr", data: stderr.endsWith("\n") ? stderr : `${stderr}\n`, timestamp: Date.now() });
    }

    currentStatus = code && code !== 0 ? "error" : "done";
    resolveExit(code ?? 0);
  });

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
            return Promise.resolve({ value: undefined as unknown as AgentOutput, done: true });
          }
          return new Promise((r) => { resolve = r; });
        },
      };
    },
  };

  return {
    send(_input: string) {
      // One-shot mode — no interactive input supported
    },
    output,
    get status() { return currentStatus; },
    set status(s: AgentStatus) { currentStatus = s; },
    buffer,
    async kill() {
      if (!child.killed) {
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 2000);
      }
      currentStatus = "done";
      resolveExit(0);
    },
    done,
    task,
    agentName: "claude-code",
    onData(listener: (data: string) => void): () => void {
      emitter.on("data", listener);
      return () => emitter.off("data", listener);
    },
    resize() {
      // No-op for piped mode.
    },
  };
}

function createClaudeTextBridge(options: {
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
  let sessionId: string | null = null;
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

    const args = ["-p", "--output-format", "stream-json", "--verbose"];
    if (sessionId) {
      args.push("--resume", sessionId);
    }
    args.push(prompt);

    const child = spawn("claude", args, { cwd, env, stdio: "pipe" });
    activeChild = child;

    let lineBuf = "";
    let stderr = "";
    let hasOutput = false;

    child.stdout.on("data", (chunk: Buffer | string) => {
      lineBuf += chunk.toString();
      const lines = lineBuf.split("\n");
      lineBuf = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed) as Record<string, unknown>;

          // Capture session_id from any event that has it
          if (typeof event.session_id === "string") {
            sessionId = event.session_id;
          }

          const outputs = processStreamEvent(event);
          for (const out of outputs) {
            pushOutput(out.data, out.type);
            // Patch the last buffer entry with activity metadata
            if (out.activity && buffer.length > 0) {
              buffer[buffer.length - 1].activity = out.activity;
            }
            hasOutput = true;
          }

          // Handle error status from result events
          if (event.type === "result" && event.is_error) {
            currentStatus = "error";
          }
        } catch {
          // Not valid JSON — push raw line
          pushOutput(`${trimmed}\n`, "stdout");
          hasOutput = true;
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      pushOutput(`Claude launch error: ${err.message}\n`, "stderr");
      activeChild = null;
      processing = false;
      currentStatus = "error";
      runNext();
    });

    child.on("close", (code) => {
      activeChild = null;
      processing = false;

      // Process remaining line buffer
      if (lineBuf.trim()) {
        try {
          const event = JSON.parse(lineBuf.trim()) as Record<string, unknown>;
          if (typeof event.session_id === "string") {
            sessionId = event.session_id;
          }
          const outputs = processStreamEvent(event);
          for (const out of outputs) {
            pushOutput(out.data, out.type);
            if (out.activity && buffer.length > 0) {
              buffer[buffer.length - 1].activity = out.activity;
            }
            hasOutput = true;
          }
          if (event.type === "result" && event.is_error) {
            currentStatus = "error";
          }
        } catch {
          pushOutput(`${lineBuf.trim()}\n`, "stdout");
        }
      }

      if (stderr.trim()) {
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
    agentName: "claude-code",
    onData(listener: (data: string) => void): () => void {
      emitter.on("data", listener);
      return () => emitter.off("data", listener);
    },
    resize() {
      // No-op for text bridge mode.
    },
  };
}
