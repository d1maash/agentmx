import React, { useState, useCallback } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { AgentTabs } from "./components/AgentTabs.js";
import { AgentView } from "./components/AgentView.js";
import { SplitView } from "./components/SplitView.js";
import { StatusBar } from "./components/StatusBar.js";
import { useAgents } from "./hooks/useAgents.js";
import { useKeyboard } from "./hooks/useKeyboard.js";
import type { ProcessManager } from "../core/process-manager.js";
import type { Config } from "../config/schema.js";

interface AppProps {
  processManager: ProcessManager;
  config: Config;
  initialTask?: string;
  initialAgent?: string;
  parallelAgents?: string[];
  splitView?: boolean;
  /** Focus an existing running agent (raw passthrough) */
  onFocus?: (sessionId: string) => void;
  /** Start a new agent and immediately enter raw passthrough */
  onStartFresh?: (agentName: string) => void;
  /** Quit the app */
  onQuit?: () => void;
}

export function App({
  processManager,
  config,
  initialTask,
  initialAgent,
  parallelAgents,
  splitView = false,
  onFocus,
  onStartFresh,
  onQuit,
}: AppProps) {
  const { exit } = useApp();
  const {
    sessions,
    startAgent,
    stopAgent,
    adapters,
    error,
    clearError,
  } = useAgents(processManager, config);

  const [showNewAgent, setShowNewAgent] = useState(false);
  const [initialized, setInitialized] = useState(false);

  const { activeIndex } = useKeyboard({
    sessionsCount: sessions.length,
    onQuit: async () => {
      if (onQuit) {
        onQuit();
      } else {
        await processManager.stopAll();
        exit();
      }
    },
    onNewAgent: () => setShowNewAgent(true),
    onKillAgent: async () => {
      const session = sessions[activeIndex];
      if (session) {
        await stopAgent(session.id);
      }
    },
  });

  // Initialize with task if provided (for `agentmux run`)
  React.useEffect(() => {
    if (initialized) return;
    setInitialized(true);

    if (initialTask && parallelAgents && parallelAgents.length > 0) {
      for (const agent of parallelAgents) {
        startAgent(agent, initialTask).catch(() => {});
      }
    } else if (initialTask) {
      const agent = initialAgent ?? config.default_agent;
      startAgent(agent, initialTask).catch(() => {});
    }
  }, [
    initialized,
    initialTask,
    initialAgent,
    parallelAgents,
    config,
    startAgent,
  ]);

  // Enter → focus on existing agent (raw passthrough)
  useInput((_input, key) => {
    if (key.return && !showNewAgent && sessions.length > 0) {
      const session = sessions[activeIndex];
      if (session && onFocus) {
        onFocus(session.id);
      }
    }
  });

  // Select agent from menu → spawn fresh in raw mode
  const handleNewAgent = useCallback(
    (agentName: string) => {
      const agent = agentName.trim();
      setShowNewAgent(false);
      if (adapters.has(agent) && onStartFresh) {
        // Don't spawn here — let interactive.ts spawn in raw mode
        onStartFresh(agent);
      }
    },
    [adapters, onStartFresh]
  );

  // Dismiss error
  useInput(() => {
    if (error) clearError();
  });

  const activeSession = sessions[activeIndex];

  // New agent prompt
  if (showNewAgent) {
    const availableAgents = Array.from(adapters.keys());

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Start new agent</Text>
        <Text>Available: {availableAgents.join(", ")}</Text>
        <Box marginTop={1}>
          <NewAgentPrompt
            agents={availableAgents}
            onSelect={handleNewAgent}
            onCancel={() => setShowNewAgent(false)}
          />
        </Box>
      </Box>
    );
  }

  // Split view for parallel mode
  if (splitView && sessions.length > 1) {
    return (
      <Box flexDirection="column" height="100%">
        <SplitView sessions={sessions} direction={config.ui.split_view} />
        <StatusBar session={activeSession} focused={false} />
      </Box>
    );
  }

  // Normal TUI view
  return (
    <Box flexDirection="column" height="100%">
      <AgentTabs sessions={sessions} activeIndex={activeIndex} />
      {error && (
        <Box paddingX={1} borderStyle="single" borderColor="red">
          <Text color="red" bold>Error: </Text>
          <Text color="red">{error}</Text>
          <Text dimColor> (press any key to dismiss)</Text>
        </Box>
      )}
      <Box borderStyle="single" borderColor="gray" flexGrow={1}>
        <AgentView session={activeSession} />
      </Box>
      <StatusBar session={activeSession} focused={false} />
    </Box>
  );
}

// Agent selector
function NewAgentPrompt({
  agents,
  onSelect,
  onCancel,
}: {
  agents: string[];
  onSelect: (agent: string) => void;
  onCancel: () => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) setSelectedIndex((i) => Math.max(0, i - 1));
    if (key.downArrow) setSelectedIndex((i) => Math.min(agents.length - 1, i + 1));
    if (key.return) onSelect(agents[selectedIndex]);
    if (key.escape) onCancel();
  });

  return (
    <Box flexDirection="column">
      {agents.map((agent, i) => (
        <Text key={agent} inverse={i === selectedIndex}>
          {i === selectedIndex ? " > " : "   "}
          {agent}
        </Text>
      ))}
      <Text dimColor>↑/↓ select | Enter confirm | Esc cancel</Text>
    </Box>
  );
}
