import { useState, useEffect, useCallback } from "react";
import type { AgentAdapter, AgentOutput, AgentStatus } from "../../adapters/types.js";
import type { ProcessManager } from "../../core/process-manager.js";
import type { Config } from "../../config/schema.js";
import { ClaudeCodeAdapter } from "../../adapters/claude-code.js";
import { CodexAdapter } from "../../adapters/codex.js";
import { AiderAdapter } from "../../adapters/aider.js";
import { CustomAdapter } from "../../adapters/custom.js";

export interface AgentSession {
  id: string;
  agentName: string;
  displayName: string;
  task: string;
  status: AgentStatus;
  buffer: AgentOutput[];
  startedAt: number;
}

function createAdapters(config: Config): Map<string, AgentAdapter> {
  const adapters = new Map<string, AgentAdapter>();

  for (const [name, agentConfig] of Object.entries(config.agents)) {
    if (!agentConfig.enabled) continue;

    let adapter: AgentAdapter;
    switch (name) {
      case "claude-code":
        adapter = new ClaudeCodeAdapter();
        break;
      case "codex":
        adapter = new CodexAdapter();
        break;
      case "aider":
        adapter = new AiderAdapter();
        break;
      default:
        adapter = new CustomAdapter({
          name,
          command: agentConfig.command,
          defaultArgs: agentConfig.args,
          env: agentConfig.env,
        });
    }
    adapters.set(name, adapter);
  }

  return adapters;
}

export function useAgents(processManager: ProcessManager, config: Config) {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adapters] = useState(() => createAdapters(config));

  // Sync sessions from process manager
  const refreshSessions = useCallback(() => {
    const pmSessions = processManager.getSessions();
    setSessions(
      pmSessions.map((s) => ({
        id: s.id,
        agentName: s.agentName,
        displayName:
          adapters.get(s.agentName)?.info.displayName ?? s.agentName,
        task: s.task,
        status: s.process.status,
        buffer: s.process.buffer,
        startedAt: s.startedAt,
      }))
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
        const agentConfig = config.agents[agentName];
        const sessionId = await processManager.start(adapter, task, {
          args: agentConfig?.args?.length
            ? [...agentConfig.args, task]
            : undefined,
        });

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
