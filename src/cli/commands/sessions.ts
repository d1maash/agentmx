import chalk from "chalk";
import {
  listSessions,
  deleteSession,
  clearAllSessions,
} from "../../core/session-store.js";

interface SessionsOptions {
  clear?: boolean;
  delete?: string;
}

export async function sessionsCommand(options: SessionsOptions): Promise<void> {
  if (options.clear) {
    const count = clearAllSessions();
    console.log(
      count > 0
        ? chalk.green(`Cleared ${count} saved session(s).`)
        : chalk.yellow("No saved sessions to clear.")
    );
    return;
  }

  if (options.delete) {
    const ok = deleteSession(options.delete);
    console.log(
      ok
        ? chalk.green(`Deleted session: ${options.delete}`)
        : chalk.red(`Session not found: ${options.delete}`)
    );
    return;
  }

  const sessions = listSessions();

  if (sessions.length === 0) {
    console.log(chalk.yellow("No saved sessions found."));
    return;
  }

  // Table header
  const header = [
    padRight("Session ID", 36),
    padRight("Agent", 14),
    padRight("Task", 30),
    padRight("Status", 8),
    padRight("Date", 20),
  ].join("  ");

  console.log(chalk.bold(header));
  console.log(chalk.gray("─".repeat(header.length)));

  for (const s of sessions) {
    const date = new Date(s.endedAt).toLocaleString();
    const statusColor = s.status === "done" ? chalk.green : chalk.red;
    const row = [
      padRight(s.id, 36),
      padRight(s.agentName, 14),
      padRight(truncate(s.task, 30), 30),
      statusColor(padRight(s.status, 8)),
      padRight(date, 20),
    ].join("  ");
    console.log(row);
  }

  console.log(
    chalk.gray(`\n${sessions.length} session(s). Use "amx resume <id>" to resume.`)
  );
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + " ".repeat(len - s.length);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
