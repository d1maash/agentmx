import type { AgentAdapter, AgentProcess, AgentStatus, SpawnOptions } from "../adapters/types.js";
import { type Session, createSessionId, getSessionSummary } from "./session.js";
import { EventEmitter } from "node:events";

export class ProcessManager extends EventEmitter {
  private sessions: Map<string, Session> = new Map();

  /** Start an agent and return session ID */
  async start(
    adapter: AgentAdapter,
    task: string,
    opts?: SpawnOptions
  ): Promise<string> {
    const id = createSessionId();
    const agentProcess = adapter.spawn(task, opts);

    const session: Session = {
      id,
      agentName: adapter.info.name,
      task,
      process: agentProcess,
      startedAt: Date.now(),
    };

    this.sessions.set(id, session);
    this.emit("session:start", session);

    // Listen for process completion
    agentProcess.done.then(({ exitCode }) => {
      this.emit("session:end", session, exitCode);
    });

    return id;
  }

  /** Get process by session ID */
  get(sessionId: string): AgentProcess | undefined {
    return this.sessions.get(sessionId)?.process;
  }

  /** Get full session info */
  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /** List all active sessions */
  list(): Array<{
    id: string;
    agent: string;
    status: AgentStatus;
    task: string;
    uptime: number;
  }> {
    return Array.from(this.sessions.values()).map(getSessionSummary);
  }

  /** Get all sessions */
  getSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  /** Send input to a specific session */
  send(sessionId: string, input: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.process.send(input);
    }
  }

  /** Stop a session */
  async stop(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      await session.process.kill();
      this.sessions.delete(sessionId);
      this.emit("session:stop", session);
    }
  }

  /** Stop all sessions */
  async stopAll(): Promise<void> {
    const promises = Array.from(this.sessions.keys()).map((id) =>
      this.stop(id)
    );
    await Promise.allSettled(promises);
  }

  /** Number of active sessions */
  get size(): number {
    return this.sessions.size;
  }
}
