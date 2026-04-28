import { useState, useEffect, useCallback, useRef } from "react";
import type {
  AgentAdapter,
  AgentOutput,
  AgentProgress,
  AgentStatus,
} from "../../adapters/types.js";
import type { ProcessManager } from "../../core/process-manager.js";
import type { Config } from "../../config/schema.js";
import { createAdapters } from "../../adapters/factory.js";
import { getProcessHealth, type ProcessHealthSnapshot } from "../../core/process-health.js";

export interface AgentSession {
  id: string;
  agentName: string;
  displayName: string;
  task: string;
  status: AgentStatus;
  buffer: AgentOutput[];
  startedAt: number;
  /** Last tool name invoked (computed from activity buffer, Claude Code only) */
  lastTool?: string;
  pid?: number;
  cpuPercent?: number;
  memoryBytes?: number;
  progress?: AgentProgress;
}

export function useAgents(processManager: ProcessManager, config: Config) {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adapters] = useState(() => createAdapters(config));
  const healthBySessionIdRef = useRef<Record<string, ProcessHealthSnapshot>>({});

  const resolveProgress = useCallback((
    status: AgentStatus,
    task: string,
    agentName: string,
    progress: AgentProgress | undefined,
    lastTool: string | undefined
  ): AgentProgress | undefined => {
    if (progress) return progress;
    if (status !== "running") return undefined;
    if (task !== "interactive" || agentName === "codex" || lastTool) {
      return {
        indeterminate: true,
        label: lastTool ?? "Working",
      };
    }
    return undefined;
  }, []);

  // Sync sessions from process manager
  const refreshSessions = useCallback(() => {
    const pmSessions = processManager.getSessions();
    const healthBySessionId = healthBySessionIdRef.current;
    setSessions(
      pmSessions.map((s) => {
        // Compute lastTool from most recent tool_call activity
        let lastTool: string | undefined;
        for (let i = s.process.buffer.length - 1; i >= 0; i--) {
          const act = s.process.buffer[i].activity;
          if (act?.kind === "tool_call") {
            lastTool = act.toolName;
            break;
          }
        }
        return {
          id: s.id,
          agentName: s.agentName,
          displayName:
            adapters.get(s.agentName)?.info.displayName ?? s.agentName,
          task: s.task,
          status: s.process.status,
          buffer: s.process.buffer,
          startedAt: s.startedAt,
          lastTool,
          pid: s.process.pid,
          cpuPercent: healthBySessionId[s.id]?.cpuPercent,
          memoryBytes: healthBySessionId[s.id]?.memoryBytes,
          progress: resolveProgress(
            s.process.status,
            s.task,
            s.agentName,
            s.process.progress,
            lastTool
          ),
        };
      })
    );
  }, [processManager, adapters, resolveProgress]);

  useEffect(() => {
    const onStart = () => refreshSessions();
    const onEnd = () => refreshSessions();
    const onStop = () => refreshSessions();

    processManager.on("session:start", onStart);
    processManager.on("session:end", onEnd);
    processManager.on("session:stop", onStop);

    // Poll for buffer/status updates
    const interval = setInterval(refreshSessions, 200);

    return () => {
      processManager.off("session:start", onStart);
      processManager.off("session:end", onEnd);
      processManager.off("session:stop", onStop);
      clearInterval(interval);
    };
  }, [processManager, refreshSessions]);

  useEffect(() => {
    let disposed = false;
    let refreshToken = 0;

    const refreshHealth = async () => {
      const token = ++refreshToken;
      const pmSessions = processManager.getSessions();
      const sessionPids = pmSessions
        .map((session) => ({
          id: session.id,
          pid: session.process.pid,
        }))
        .filter((session): session is { id: string; pid: number } =>
          typeof session.pid === "number" && Number.isInteger(session.pid) && session.pid > 0
        );

      if (sessionPids.length === 0) {
        healthBySessionIdRef.current = {};
        if (!disposed) refreshSessions();
        return;
      }

      const healthByPid = await getProcessHealth(sessionPids.map((session) => session.pid));
      if (disposed || token !== refreshToken) return;

      const nextHealthBySessionId: Record<string, ProcessHealthSnapshot> = {};
      for (const session of sessionPids) {
        const health = healthByPid.get(session.pid);
        if (health) {
          nextHealthBySessionId[session.id] = health;
        }
      }

      healthBySessionIdRef.current = nextHealthBySessionId;
      refreshSessions();
    };

    const onSessionChange = () => {
      void refreshHealth();
    };

    processManager.on("session:start", onSessionChange);
    processManager.on("session:end", onSessionChange);
    processManager.on("session:stop", onSessionChange);

    void refreshHealth();
    const interval = setInterval(() => {
      void refreshHealth();
    }, 1000);

    return () => {
      disposed = true;
      refreshToken += 1;
      processManager.off("session:start", onSessionChange);
      processManager.off("session:end", onSessionChange);
      processManager.off("session:stop", onSessionChange);
      clearInterval(interval);
    };
  }, [processManager, refreshSessions]);

  const clearError = useCallback(() => setError(null), []);

  const startAgent = useCallback(
    async (agentName: string, task: string, args?: string[]) => {
      const adapter = adapters.get(agentName);
      if (!adapter) {
        setError(`Agent "${agentName}" is not configured. Check .agentmx.yml`);
        return undefined;
      }

      try {
        // Let adapter decide args based on task
        // Don't override args for interactive mode
        const opts = args ? { args } : undefined;
        const sessionId = await processManager.start(adapter, task, opts);

        setError(null);
        refreshSessions();
        return sessionId;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        return undefined;
      }
    },
    [adapters, processManager, config, refreshSessions]
  );

  const stopAgent = useCallback(
    async (sessionId: string) => {
      await processManager.stop(sessionId);
      refreshSessions();
    },
    [processManager, refreshSessions]
  );

  const sendInput = useCallback(
    (sessionId: string, input: string) => {
      processManager.send(sessionId, input);
    },
    [processManager]
  );

  return {
    sessions,
    adapters,
    error,
    clearError,
    startAgent,
    stopAgent,
    sendInput,
    refreshSessions,
  };
}
