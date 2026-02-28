import { useState, useEffect, useCallback } from "react";
import type { AgentAdapter, AgentOutput, AgentStatus } from "../../adapters/types.js";
import type { ProcessManager } from "../../core/process-manager.js";
import type { Config } from "../../config/schema.js";
import { createAdapters } from "../../adapters/factory.js";

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
}

export function useAgents(processManager: ProcessManager, config: Config) {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adapters] = useState(() => createAdapters(config));

  // Sync sessions from process manager
  const refreshSessions = useCallback(() => {
    const pmSessions = processManager.getSessions();
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
        };
      })
    );
  }, [processManager, adapters]);

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

  const clearError = useCallback(() => setError(null), []);

  const startAgent = useCallback(
    async (agentName: string, task: string) => {
      const adapter = adapters.get(agentName);
      if (!adapter) {
        setError(`Agent "${agentName}" is not configured. Check .agentmux.yml`);
        return undefined;
      }

      try {
        // Let adapter decide args based on task
        // Don't override args for interactive mode
        const sessionId = await processManager.start(adapter, task);

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
