import { mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { AgentOutput, ClaudeActivity } from "../adapters/types.js";
import type { Session } from "./session.js";

const SESSIONS_DIR = join(homedir(), ".agentmx", "sessions");

export interface SerializedOutput {
  type: "stdout" | "stderr" | "system";
  data: string;
  timestamp: number;
  activity?: ClaudeActivity;
}

export interface SavedSession {
  id: string;
  agentName: string;
  task: string;
  startedAt: number;
  endedAt: number;
  exitCode: number;
  status: "done" | "error";
  cwd: string;
  buffer: SerializedOutput[];
}

function ensureDir(): void {
  mkdirSync(SESSIONS_DIR, { recursive: true });
}

function sessionPath(id: string): string {
  // Sanitize id to prevent path traversal
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(SESSIONS_DIR, `${safe}.json`);
}

export function saveSession(
  session: Session,
  exitCode: number,
  cwd: string
): void {
  ensureDir();

  const buffer: SerializedOutput[] = session.process.buffer.map(
    (out: AgentOutput) => ({
      type: out.type,
      data: out.data,
      timestamp: out.timestamp,
      ...(out.activity ? { activity: out.activity } : {}),
    })
  );

  // Skip empty sessions
  if (buffer.length === 0) return;

  const saved: SavedSession = {
    id: session.id,
    agentName: session.agentName,
    task: session.task,
    startedAt: session.startedAt,
    endedAt: Date.now(),
    exitCode,
    status: exitCode === 0 ? "done" : "error",
    cwd,
    buffer,
  };

  writeFileSync(sessionPath(session.id), JSON.stringify(saved, null, 2));
}

export function listSessions(): SavedSession[] {
  ensureDir();

  try {
    const files = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json"));
    const sessions: SavedSession[] = [];

    for (const file of files) {
      try {
        const data = readFileSync(join(SESSIONS_DIR, file), "utf-8");
        sessions.push(JSON.parse(data) as SavedSession);
      } catch {
        // Skip corrupt files
      }
    }

    // Sort by endedAt descending (most recent first)
    sessions.sort((a, b) => b.endedAt - a.endedAt);
    return sessions;
  } catch {
    return [];
  }
}

export function loadSession(id: string): SavedSession | null {
  try {
    const data = readFileSync(sessionPath(id), "utf-8");
    return JSON.parse(data) as SavedSession;
  } catch {
    return null;
  }
}

export function deleteSession(id: string): boolean {
  try {
    unlinkSync(sessionPath(id));
    return true;
  } catch {
    return false;
  }
}

export function cleanOldSessions(maxAgeDays = 30): number {
  ensureDir();
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let removed = 0;

  try {
    const files = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const filePath = join(SESSIONS_DIR, file);
      try {
        const stat = statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          unlinkSync(filePath);
          removed++;
        }
      } catch {
        // Skip
      }
    }
  } catch {
    // Directory doesn't exist yet
  }

  return removed;
}

export function clearAllSessions(): number {
  ensureDir();
  let removed = 0;

  try {
    const files = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        unlinkSync(join(SESSIONS_DIR, file));
        removed++;
      } catch {
        // Skip
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return removed;
}
