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
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { appendFileSync } from "node:fs";
import { spawnPty } from "./pty-helpers.js";

function debugLog(msg: string) {
  try { appendFileSync("/tmp/agentmux-debug.log", `${Date.now()} ${msg}\n`); } catch {}
}

const require = createRequire(import.meta.url);
const pty = require("node-pty");

/**
 * Build a clean env for spawning Claude sub-processes.
 * Removes ALL variables that prevent nested Claude Code sessions.
 */
function cleanClaudeEnv(extra?: Record<string, string>): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, val] of Object.entries(process.env)) {
    if (val === undefined) continue;
    // Strip CLAUDECODE, CLAUDE_CODE, CLAUDE_CODE_ENTRYPOINT, CLAUDE_CODE_* etc.
    if (key === "CLAUDECODE" || key.startsWith("CLAUDE_CODE")) continue;
    clean[key] = val;
  }
  return { ...clean, ...extra };
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

/** Strip ANSI escape sequences from a string */
function stripAnsi(s: string): string {
  return s
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B[@-Z\\-_]/g, "")
    .replace(/\r/g, "");
}

/** Spawn Claude in one-shot task mode with structured stream-json output via PTY */
function createClaudeStreamJson(options: {
  task: string;
  cwd: string;
  env: Record<string, string>;
}): AgentProcess {
  const { task, cwd, env } = options;
  const emitter = new EventEmitter();
  const buffer: AgentOutput[] = [];
  let currentStatus: AgentStatus = "running";
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

  // --- Streaming state for --include-partial-messages ---
  const activeBlocks = new Map<number, {
    type: "thinking" | "text" | "tool_use";
    bufferIndex: number;
    accText: string;
    accJson: string;
    toolName?: string;
    toolId?: string;
  }>();
  let hasStreamEvents = false;

  function handleParsedEvent(event: Record<string, unknown>) {
    const type = event.type as string | undefined;
    const subtype = (type === "stream_event" && event.event)
      ? (event.event as Record<string, unknown>).type as string
      : undefined;
    debugLog(`EVENT: type=${type} sub=${subtype ?? event.subtype ?? "-"} bufLen=${buffer.length}`);

    if (type === "stream_event") {
      hasStreamEvents = true;
      const se = event.event as Record<string, unknown>;
      if (se) handleStreamSubEvent(se);
      return;
    }

    // Skip duplicate assistant messages — already shown via stream events
    if (type === "assistant" && hasStreamEvents) {
      debugLog("SKIP assistant (has stream events)");
      return;
    }
    // Skip rate limit events
    if (type === "rate_limit_event") return;

    // Process other events normally (system/init, user/tool_result, result/cost)
    const outputs = processStreamEvent(event);
    debugLog(`processStreamEvent => ${outputs.length} outputs`);
    for (const out of outputs) pushOutput(out);
  }

  function handleStreamSubEvent(se: Record<string, unknown>) {
    const seType = se.type as string;

    switch (seType) {
      case "message_start":
        activeBlocks.clear();
        break;

      case "content_block_start": {
        const index = se.index as number;
        const block = se.content_block as Record<string, unknown>;
        if (!block) break;
        const blockType = block.type as string;

        if (blockType === "thinking") {
          const out: AgentOutput = {
            type: "stdout",
            data: "thinking...\n",
            timestamp: Date.now(),
            activity: { kind: "thinking", text: "", streaming: true },
          };
          pushOutput(out);
          activeBlocks.set(index, {
            type: "thinking",
            bufferIndex: buffer.length - 1,
            accText: "",
            accJson: "",
          });
        } else if (blockType === "text") {
          const out: AgentOutput = {
            type: "stdout",
            data: "",
            timestamp: Date.now(),
            activity: { kind: "text", text: "", streaming: true },
          };
          pushOutput(out);
          activeBlocks.set(index, {
            type: "text",
            bufferIndex: buffer.length - 1,
            accText: "",
            accJson: "",
          });
        } else if (blockType === "tool_use") {
          const toolName = String(block.name ?? "unknown");
          const toolId = String(block.id ?? "");
          const out: AgentOutput = {
            type: "stdout",
            data: `[${toolName}] ...\n`,
            timestamp: Date.now(),
            activity: { kind: "tool_call", toolName, toolId, input: {}, streaming: true },
          };
          pushOutput(out);
          activeBlocks.set(index, {
            type: "tool_use",
            bufferIndex: buffer.length - 1,
            accText: "",
            accJson: "",
            toolName,
            toolId,
          });
        }
        break;
      }

      case "content_block_delta": {
        const index = se.index as number;
        const delta = se.delta as Record<string, unknown>;
        if (!delta) break;
        const deltaType = delta.type as string;
        const block = activeBlocks.get(index);
        if (!block) break;

        if (deltaType === "thinking_delta" && block.type === "thinking") {
          const chunk = (delta.thinking as string) ?? "";
          if (chunk) {
            block.accText += chunk;
            const entry = buffer[block.bufferIndex];
            if (entry) {
              entry.data = block.accText;
              const act = entry.activity;
              if (act && act.kind === "thinking") {
                act.text = block.accText;
              }
            }
          }
        } else if (deltaType === "text_delta" && block.type === "text") {
          block.accText += delta.text as string;
          const entry = buffer[block.bufferIndex];
          if (entry) {
            entry.data = block.accText;
            const act = entry.activity;
            if (act && act.kind === "text") {
              act.text = block.accText;
            }
          }
        } else if (deltaType === "input_json_delta" && block.type === "tool_use") {
          block.accJson += delta.partial_json as string;
          const entry = buffer[block.bufferIndex];
          if (entry) {
            try {
              const input = JSON.parse(block.accJson) as Record<string, unknown>;
              entry.data = `${formatToolCall(block.toolName!, input)}\n`;
              const act = entry.activity;
              if (act && act.kind === "tool_call") act.input = input;
            } catch {
              const hint = block.accJson.replace(/[{}"]/g, "").trim();
              if (hint) entry.data = `[${block.toolName}] ${truncate(hint, 60)}\n`;
            }
          }
        }
        break;
      }

      case "content_block_stop": {
        const index = se.index as number;
        const block = activeBlocks.get(index);
        if (!block) break;

        const entry = buffer[block.bufferIndex];
        if (entry) {
          if (block.type === "tool_use" && block.accJson) {
            try {
              const input = JSON.parse(block.accJson) as Record<string, unknown>;
              entry.data = `${formatToolCall(block.toolName!, input)}\n`;
              const act = entry.activity;
              if (act && act.kind === "tool_call") {
                act.input = input;
                act.streaming = false;
              }
            } catch { /* ignore */ }
          }
          if (block.type === "text") {
            const act = entry.activity;
            if (act && act.kind === "text") act.streaming = false;
          }
          if (block.type === "thinking") {
            const act = entry.activity;
            if (act && act.kind === "thinking") act.streaming = false;
          }
        }
        activeBlocks.delete(index);
        break;
      }

      case "message_stop":
        activeBlocks.clear();
        break;
    }
  }

  const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", task];
  debugLog(`SPAWN: claude ${args.join(" ")}`);
  debugLog(`CWD: ${cwd}`);
  // Claude requires a TTY — use node-pty. Wide cols to prevent line wrapping in JSON.
  const ptyProcess = pty.spawn("claude", args, {
    name: "xterm-256color",
    cols: 2000,
    rows: 40,
    cwd,
    env,
  });
  debugLog(`PID: ${ptyProcess.pid}`);

  let lineBuf = "";

  let chunkCount = 0;
  ptyProcess.onData((rawData: string) => {
    chunkCount++;
    if (chunkCount <= 5) debugLog(`CHUNK#${chunkCount} len=${rawData.length} first80=${JSON.stringify(rawData.slice(0, 80))}`);
    lineBuf += stripAnsi(rawData);
    const lines = lineBuf.split("\n");
    lineBuf = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event = JSON.parse(trimmed) as Record<string, unknown>;
        handleParsedEvent(event);
      } catch (e) {
        debugLog(`JSON_ERR: ${(e as Error).message} line=${trimmed.slice(0, 100)}`);
        pushOutput({ type: "stdout", data: `${trimmed}\n`, timestamp: Date.now() });
      }
    }
  });

  ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
    debugLog(`EXIT: code=${exitCode} bufLen=${buffer.length}`);
    // Flush remaining line buffer
    if (lineBuf.trim()) {
      const trimmed = lineBuf.trim();
      try {
        const event = JSON.parse(trimmed) as Record<string, unknown>;
        handleParsedEvent(event);
      } catch {
        pushOutput({ type: "stdout", data: `${trimmed}\n`, timestamp: Date.now() });
      }
    }

    currentStatus = exitCode === 0 ? "done" : "error";
    resolveExit(exitCode);
  });

  const output: AsyncIterable<AgentOutput> = {
    [Symbol.asyncIterator]() {
      const localQueue: AgentOutput[] = [];
      let resolve: ((value: IteratorResult<AgentOutput>) => void) | null = null;
      let isDone = false;

      emitter.on("output", (out: AgentOutput) => {
        if (resolve) {
          const r = resolve;
          resolve = null;
          r({ value: out, done: false });
        } else {
          localQueue.push(out);
        }
      });

      emitter.on("exit", () => {
        isDone = true;
        if (resolve) {
          const r = resolve;
          resolve = null;
          r({ value: undefined as unknown as AgentOutput, done: true });
        }
      });

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
      // One-shot mode — no interactive input
    },
    output,
    get status() { return currentStatus; },
    set status(s: AgentStatus) { currentStatus = s; },
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
    resize(cols: number, rows: number) {
      try { ptyProcess.resize(Math.max(cols, 200), rows); } catch { /* ignore */ }
    },
  };
}

/** Interactive text bridge — spawns a PTY per prompt, parses stream-json */
function createClaudeTextBridge(options: {
  cwd: string;
  env: Record<string, string>;
}): AgentProcess {
  const { cwd, env } = options;
  const emitter = new EventEmitter();
  const buffer: AgentOutput[] = [];
  const queue: string[] = [];

  let currentStatus: AgentStatus = "idle";
  let activePty: ReturnType<typeof pty.spawn> | null = null;
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

    const child = pty.spawn("claude", args, {
      name: "xterm-256color",
      cols: 2000,
      rows: 40,
      cwd,
      env,
    });
    activePty = child;

    let lineBuf = "";
    let hasOutput = false;

    child.onData((rawData: string) => {
      lineBuf += stripAnsi(rawData);
      const lines = lineBuf.split("\n");
      lineBuf = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed) as {
            type?: string;
            subtype?: string;
            session_id?: string;
            is_error?: boolean;
            result?: string;
            message?: {
              content?: Array<{ type: string; text?: string }>;
            };
          };

          if (typeof event.session_id === "string") {
            sessionId = event.session_id;
          }

          if (event.type === "assistant" && Array.isArray(event.message?.content)) {
            for (const block of event.message!.content) {
              if (block.type === "text" && block.text) {
                pushOutput(block.text.endsWith("\n") ? block.text : `${block.text}\n`, "stdout");
                hasOutput = true;
              }
            }
          }

          if (event.type === "result") {
            if (event.is_error) {
              currentStatus = "error";
            }
            if (!hasOutput && typeof event.result === "string" && event.result.length > 0) {
              const text = event.result.startsWith("\n") ? event.result.slice(1) : event.result;
              pushOutput(text.endsWith("\n") ? text : `${text}\n`, "stdout");
              hasOutput = true;
            }
          }
        } catch {
          pushOutput(`${trimmed}\n`, "stdout");
          hasOutput = true;
        }
      }
    });

    child.onExit(({ exitCode }: { exitCode: number }) => {
      activePty = null;
      processing = false;

      // Flush remaining buffer
      if (lineBuf.trim()) {
        const trimmed = lineBuf.trim();
        try {
          const event = JSON.parse(trimmed) as { type?: string; session_id?: string; is_error?: boolean };
          if (typeof event.session_id === "string") sessionId = event.session_id;
          if (event.type === "result" && event.is_error) currentStatus = "error";
        } catch {
          pushOutput(`${trimmed}\n`, "stdout");
        }
      }

      if (exitCode !== 0) {
        currentStatus = "error";
      }

      if (stopped) {
        currentStatus = "done";
        resolveExit(exitCode);
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

      emitter.on("output", (out: AgentOutput) => {
        if (resolve) {
          const r = resolve;
          resolve = null;
          r({ value: out, done: false });
        } else {
          localQueue.push(out);
        }
      });

      emitter.on("exit", () => {
        isDone = true;
        if (resolve) {
          const r = resolve;
          resolve = null;
          r({ value: undefined as unknown as AgentOutput, done: true });
        }
      });

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
    get status() { return currentStatus; },
    set status(s: AgentStatus) { currentStatus = s; },
    buffer,
    async kill() {
      stopped = true;
      queue.length = 0;

      if (activePty) {
        try {
          const treeKill = (await import("tree-kill")).default;
          const pid = activePty.pid;
          await new Promise<void>((resolve, reject) => {
            treeKill(pid, "SIGTERM", (err?: Error) => {
              if (err) reject(err);
              else resolve();
            });
          });
        } catch {
          activePty?.kill();
        }
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
      // No-op — each prompt spawns its own PTY.
    },
  };
}
