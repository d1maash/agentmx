import type { AgentProcess, AgentStatus } from "../adapters/types.js";

export interface Session {
  id: string;
  agentName: string;
  task: string;
  process: AgentProcess;
  startedAt: number;
}

let sessionCounter = 0;

export function createSessionId(): string {
  return `session-${++sessionCounter}-${Date.now()}`;
}

export function getSessionSummary(session: Session): {
  id: string;
  agent: string;
  status: AgentStatus;
  task: string;
  uptime: number;
} {
  return {
    id: session.id,
    agent: session.agentName,
    status: session.process.status,
    task: session.task,
    uptime: Date.now() - session.startedAt,
  };
}
