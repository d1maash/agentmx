import React from "react";
import { render } from "ink";
import chalk from "chalk";
import { createInterface } from "node:readline";
import { App } from "../../tui/App.js";
import { ProcessManager } from "../../core/process-manager.js";
import {
  listSessions,
  loadSession,
  type SavedSession,
} from "../../core/session-store.js";
import type { Config } from "../../config/schema.js";

export async function resumeCommand(
  sessionId: string | undefined,
  config: Config
): Promise<void> {
  let saved: SavedSession | null = null;

  if (sessionId) {
    saved = loadSession(sessionId);
    if (!saved) {
      console.log(chalk.red(`Session not found: ${sessionId}`));
      process.exit(1);
    }
  } else {
    // Interactive session picker
    const sessions = listSessions();
    if (sessions.length === 0) {
      console.log(chalk.yellow("No saved sessions to resume."));
      return;
    }
    saved = await pickSession(sessions);
    if (!saved) return; // User cancelled
  }

  // Determine resume strategy
  const isClaudeCode = saved.agentName === "claude-code";

  // Extract Claude session ID from init activity if available
  let claudeSessionId: string | undefined;
  if (isClaudeCode) {
    for (const entry of saved.buffer) {
      if (entry.activity?.kind === "init" && entry.activity.sessionId) {
        claudeSessionId = entry.activity.sessionId;
        break;
      }
    }
  }

  const pm = new ProcessManager(saved.cwd);

  const cleanup = async () => {
    await pm.stopAll();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Build spawn args for resume
  let resumeAgent = saved.agentName;
  let resumeTask: string;
  let resumeArgs: string[] | undefined;

  if (isClaudeCode && claudeSessionId) {
    // Claude Code native resume
    resumeTask = "interactive";
    resumeArgs = ["--resume", claudeSessionId];
  } else {
    // Other agents: spawn interactively with context
    resumeTask = "interactive";
  }

  // Pre-fill the buffer with previous output as a system message
  const previousOutput = saved.buffer
    .filter((e) => e.type === "stdout" || e.type === "system")
    .map((e) => e.data)
    .join("");

  const contextPrefix = previousOutput
    ? `--- Previous session (${saved.agentName}: ${saved.task}) ---\n${previousOutput}\n--- Resuming ---\n`
    : "";

  process.stdout.write("\x1b[?1049h");
  const inkInstance = render(
    React.createElement(App, {
      processManager: pm,
      config,
      initialTask: resumeTask,
      initialAgent: resumeAgent,
      resumeContext: contextPrefix || undefined,
      resumeArgs,
    })
  );
  await inkInstance.waitUntilExit();
  process.stdout.write("\x1b[?1049l");

  await pm.stopAll();
}

async function pickSession(
  sessions: SavedSession[]
): Promise<SavedSession | null> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log(chalk.bold("\nSaved Sessions:\n"));
    sessions.forEach((s, i) => {
      const date = new Date(s.endedAt).toLocaleString();
      const status = s.status === "done" ? chalk.green("done") : chalk.red("error");
      console.log(
        `  ${chalk.cyan(`[${i + 1}]`)} ${s.id}  ${chalk.dim(s.agentName)}  ${truncate(s.task, 40)}  ${status}  ${chalk.dim(date)}`
      );
    });

    console.log("");
    rl.question(
      chalk.bold("Select session number (or Enter to cancel): "),
      (answer: string) => {
        rl.close();
        const num = parseInt(answer, 10);
        if (isNaN(num) || num < 1 || num > sessions.length) {
          resolve(null);
        } else {
          resolve(sessions[num - 1]);
        }
      }
    );
  });
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
