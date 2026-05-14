import type { AgentAdapter, AgentProcess, AgentStatus, SpawnOptions } from "../adapters/types.js";
import { type Session, createSessionId, getSessionSummary } from "./session.js";
import { saveSession } from "./session-store.js";
import { checkBudgets } from "./cost-tracker.js";
import { attachBudgetGuard, type BudgetGuardHandle } from "./budget-guard.js";
import { EventEmitter } from "node:events";

export interface StartOptions extends SpawnOptions {
  /** Hard cap (USD). When the agent's reported cost crosses it, the process is killed. */
  maxCostUsd?: number;
}

export class ProcessManager extends EventEmitter {
  private sessions: Map<string, Session> = new Map();
  private guards: Map<string, BudgetGuardHandle> = new Map();
  private cwd: string;

  constructor(cwd?: string) {
    super();
    this.cwd = cwd ?? process.cwd();
  }

  /** Start an agent and return session ID */
  async start(
    adapter: AgentAdapter,
    task: string,
    opts?: StartOptions
  ): Promise<string> {
    // Check budget alerts before starting
    const alerts = checkBudgets();
    const agentAlerts = alerts.filter(
      (a) => a.level === "exceeded" && (a.scope === adapter.info.name || a.scope === "global")
    );
    if (agentAlerts.length > 0) {
      const alert = agentAlerts[0];
      this.emit("budget:exceeded", alert);
    }

    const id = createSessionId();
    const { maxCostUsd, ...spawnOpts } = opts ?? {};
    const agentProcess = adapter.spawn(task, spawnOpts);

    const session: Session = {
      id,
      agentName: adapter.info.name,
      task,
      process: agentProcess,
      startedAt: Date.now(),
    };

    this.sessions.set(id, session);
    this.emit("session:start", session);

    if (maxCostUsd && maxCostUsd > 0) {
      const guard = attachBudgetGuard(agentProcess, {
        maxCostUsd,
        onBreach: (cost, cap) => {
          this.emit("budget:hardstop", { sessionId: id, agent: adapter.info.name, cost, cap });
        },
      });
      this.guards.set(id, guard);
    }

    // Listen for process completion — auto-save session
    agentProcess.done.then(({ exitCode }) => {
      this.guards.get(id)?.stop();
      // Only save sessions with actual output
      if (session.process.buffer.length > 0) {
        try {
          saveSession(session, exitCode, this.cwd);
        } catch {
          // Don't let save failures crash the app
        }
      }
      this.emit("session:end", session, exitCode);
    });

    return id;
  }

  /** True when this session was killed by a hard-stop budget guard. */
  wasHardStopped(sessionId: string): boolean {
    return this.guards.get(sessionId)?.breached ?? false;
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
      this.guards.get(sessionId)?.stop();
      this.guards.delete(sessionId);
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
