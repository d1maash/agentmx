import React, { useState, useCallback } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { AgentTabs } from "./components/AgentTabs.js";
import { AgentView, type ScrollInfo } from "./components/AgentView.js";
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
  /** Optional external handler for starting a new agent. */
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
  onStartFresh,
  onQuit,
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
  const [inputFocused, setInputFocused] = useState(false);
  const [scrollOffsets, setScrollOffsets] = useState<Record<string, number>>({});
  const [activeScrollInfo, setActiveScrollInfo] = useState<ScrollInfo>({
    totalItems: 0,
    maxOffset: 0,
    effectiveOffset: 0,
  });

  const { activeIndex } = useKeyboard({
    sessionsCount: sessions.length,
    enabled: !showNewAgent && !inputFocused,
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
    onScrollUp: () => {
      const session = sessions[activeIndex];
      if (!session) return;
      setScrollOffsets((prev) => {
        const current = prev[session.id] ?? 0;
        return { ...prev, [session.id]: current + 1 };
      });
    },
    onScrollDown: () => {
      const session = sessions[activeIndex];
      if (!session) return;
      setScrollOffsets((prev) => {
        const current = prev[session.id] ?? 0;
        const next = Math.max(0, current - 1);
        if (next === current) return prev;
        return { ...prev, [session.id]: next };
      });
    },
    onPageUp: () => {
      const session = sessions[activeIndex];
      if (!session) return;
      setScrollOffsets((prev) => {
        const current = prev[session.id] ?? 0;
        return { ...prev, [session.id]: current + 10 };
      });
    },
    onPageDown: () => {
      const session = sessions[activeIndex];
      if (!session) return;
      setScrollOffsets((prev) => {
        const current = prev[session.id] ?? 0;
        const next = Math.max(0, current - 10);
        if (next === current) return prev;
        return { ...prev, [session.id]: next };
      });
    },
    onScrollTop: () => {
      const session = sessions[activeIndex];
      if (!session) return;
      setScrollOffsets((prev) => ({ ...prev, [session.id]: Number.MAX_SAFE_INTEGER }));
    },
    onScrollBottom: () => {
      const session = sessions[activeIndex];
      if (!session) return;
      setScrollOffsets((prev) => {
        const current = prev[session.id] ?? 0;
        if (current === 0) return prev;
        return { ...prev, [session.id]: 0 };
      });
    },
  });

  // Initialize with task if provided (for `agentmx run`)
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

  const activeSession = sessions[activeIndex];
  const activeSessionId = activeSession?.id;
  const activeScrollOffset = activeSessionId ? (scrollOffsets[activeSessionId] ?? 0) : 0;

  const handleScrollInfo = useCallback(
    (info: ScrollInfo) => {
      setActiveScrollInfo(info);
      if (!activeSessionId) return;
      setScrollOffsets((prev) => {
        const current = prev[activeSessionId] ?? 0;
        if (current === info.effectiveOffset) return prev;
        return { ...prev, [activeSessionId]: info.effectiveOffset };
      });
    },
    [activeSessionId]
  );

  React.useEffect(() => {
    if (!activeSession) {
      setInputFocused(false);
    }
  }, [activeSession]);

  React.useEffect(() => {
    setActiveScrollInfo({
      totalItems: 0,
      maxOffset: 0,
      effectiveOffset: 0,
    });
  }, [activeSessionId]);

  // Enter/Esc toggles input mode in the built-in text input.
  useInput((_input, key) => {
    if (showNewAgent || sessions.length === 0) return;

    if (key.escape && inputFocused) {
      setInputFocused(false);
      return;
    }

    if (key.return && !inputFocused) {
      setInputFocused(true);
    }
  }, { isActive: !showNewAgent });

  // Select agent from menu.
  const handleNewAgent = useCallback(
    (agentName: string) => {
      const agent = agentName.trim();
      setShowNewAgent(false);
      if (!adapters.has(agent)) return;

      if (onStartFresh) {
        onStartFresh(agent);
      } else {
        startAgent(agent, "interactive").catch(() => {});
      }
    },
    [adapters, onStartFresh, startAgent]
  );

  // Dismiss error
  useInput(() => {
    if (error) clearError();
  });

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
      <Box flexDirection="column" height="100%" width="100%" overflow="hidden">
        <SplitView sessions={sessions} direction={config.ui.split_view} />
        {activeSession && (
          <InputBar
            agentName={activeSession.displayName}
            focused={inputFocused}
            onSubmit={(text) => sendInput(activeSession.id, text)}
          />
        )}
        <StatusBar
          session={activeSession}
          focused={inputFocused}
          scrollOffset={activeScrollOffset}
          maxScrollOffset={activeScrollInfo.maxOffset}
        />
      </Box>
    );
  }

  // Normal TUI view
  return (
    <Box flexDirection="column" height="100%" width="100%" overflow="hidden">
      <AgentTabs sessions={sessions} activeIndex={activeIndex} />
      {error && (
        <Box paddingX={1} borderStyle="single" borderColor="red" width="100%">
          <Text color="red" bold>Error: </Text>
          <Text color="red">{error}</Text>
          <Text dimColor> (press any key to dismiss)</Text>
        </Box>
      )}
      <Box
        borderStyle="single"
        borderColor="gray"
        flexGrow={1}
        width="100%"
        overflow="hidden"
      >
        <AgentView
          key={activeSession?.id ?? "none"}
          session={activeSession}
          scrollOffset={activeScrollOffset}
          onScrollInfo={handleScrollInfo}
        />
      </Box>
      {activeSession && (
        <InputBar
          agentName={activeSession.displayName}
          focused={inputFocused}
          onSubmit={(text) => sendInput(activeSession.id, text)}
        />
      )}
      <StatusBar
        session={activeSession}
        focused={inputFocused}
        scrollOffset={activeScrollOffset}
        maxScrollOffset={activeScrollInfo.maxOffset}
      />
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
