import React, { useState, useCallback } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { AgentTabs } from "./components/AgentTabs.js";
import { AgentView } from "./components/AgentView.js";
import { SplitView } from "./components/SplitView.js";
import { StatusBar } from "./components/StatusBar.js";
import { InputBar } from "./components/InputBar.js";
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
}

export function App({
  processManager,
  config,
  initialTask,
  initialAgent,
  parallelAgents,
  splitView = false,
}: AppProps) {
  const { exit } = useApp();
  const {
    sessions,
    startAgent,
    stopAgent,
    sendInput,
    adapters,
    error,
    clearError,
  } = useAgents(processManager, config);

  const [showNewAgent, setShowNewAgent] = useState(false);
  const [initialized, setInitialized] = useState(false);

  const { activeIndex, focused, setFocused } = useKeyboard({
    sessionsCount: sessions.length,
    onQuit: async () => {
      await processManager.stopAll();
      exit();
    },
    onNewAgent: () => setShowNewAgent(true),
    onKillAgent: async () => {
      const session = sessions[activeIndex];
      if (session) {
        await stopAgent(session.id);
      }
    },
  });

  // Initialize with task if provided
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

  const handleNewAgent = useCallback(
    async (agentName: string) => {
      const agent = agentName.trim();
      if (adapters.has(agent)) {
        await startAgent(agent, "interactive session");
      }
      setShowNewAgent(false);
    },
    [adapters, startAgent]
  );

  // Dismiss error on any key
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
        <Text>
          Available: {availableAgents.join(", ")}
        </Text>
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
        <StatusBar session={activeSession} focused={focused} />
      </Box>
    );
  }

  // Normal TUI view
  return (
    <Box flexDirection="column" height="100%">
      <AgentTabs sessions={sessions} activeIndex={activeIndex} />
      {error && (
        <Box paddingX={1} borderStyle="single" borderColor="red">
          <Text color="red" bold>
            Error:{" "}
          </Text>
          <Text color="red">{error}</Text>
          <Text dimColor> (press any key to dismiss)</Text>
        </Box>
      )}
      <Box borderStyle="single" borderColor="gray" flexGrow={1}>
        <AgentView session={activeSession} />
      </Box>
      <StatusBar session={activeSession} focused={focused} />
      {activeSession && (
        <InputBar
          agentName={activeSession.displayName}
          focused={focused}
          onSubmit={(text) => sendInput(activeSession.id, text)}
        />
      )}
    </Box>
  );
}

// Agent selector component
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
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(agents.length - 1, i + 1));
    }
    if (key.return) {
      onSelect(agents[selectedIndex]);
    }
    if (key.escape) {
      onCancel();
    }
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
