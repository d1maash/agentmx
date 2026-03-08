import React, { useState, useCallback, useEffect } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { AgentTabs } from "./components/AgentTabs.js";
import { AgentView, type ScrollInfo } from "./components/AgentView.js";
import { SplitView } from "./components/SplitView.js";
import { StatusBar } from "./components/StatusBar.js";
import { InputBar } from "./components/InputBar.js";
import { SearchOverlay } from "./components/SearchOverlay.js";
import { BookmarkList } from "./components/BookmarkList.js";
import { SnippetPicker } from "./components/SnippetPicker.js";
import { DiffView } from "./components/DiffView.js";
import { DashboardView } from "./components/DashboardView.js";
import { useAgents } from "./hooks/useAgents.js";
import { useKeyboard } from "./hooks/useKeyboard.js";
import { addBookmark, getBookmarks } from "./utils/bookmarks.js";
import { sendNotification } from "./utils/notifications.js";
import { sanitizeTerminalText } from "./utils/terminal.js";
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
  /** Context from a previous session to display before new output */
  resumeContext?: string;
  /** Extra args to pass to the agent spawn (e.g. --resume for Claude Code) */
  resumeArgs?: string[];
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
  resumeContext,
  resumeArgs,
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

  type OverlayMode = "none" | "newAgent" | "search" | "bookmarks" | "snippets" | "diff" | "dashboard";

  const [overlayMode, setOverlayMode] = useState<OverlayMode>("none");
  const [initialized, setInitialized] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [scrollOffsets, setScrollOffsets] = useState<Record<string, number>>({});
  const [activeScrollInfo, setActiveScrollInfo] = useState<ScrollInfo>({
    totalItems: 0,
    maxOffset: 0,
    effectiveOffset: 0,
  });
  const [bookmarkFlash, setBookmarkFlash] = useState(false);

  // Track completed sessions for notifications
  const [notifiedSessions] = useState(() => new Set<string>());
  const showNewAgent = overlayMode === "newAgent";
  const hasOverlay = overlayMode !== "none";

  // Notifications: when an agent finishes, send macOS notification
  useEffect(() => {
    for (const session of sessions) {
      if (
        (session.status === "done" || session.status === "error") &&
        !notifiedSessions.has(session.id)
      ) {
        notifiedSessions.add(session.id);
        const statusText = session.status === "done" ? "completed" : "failed";
        sendNotification(
          `AgentMX — ${session.displayName}`,
          `Task ${statusText}: ${session.task.slice(0, 100)}`
        );
      }
    }
  }, [sessions, notifiedSessions]);

  const { activeIndex } = useKeyboard({
    sessionsCount: sessions.length,
    enabled: !hasOverlay && !inputFocused,
    onQuit: async () => {
      if (onQuit) {
        onQuit();
      } else {
        await processManager.stopAll();
        exit();
      }
    },
    onNewAgent: () => setOverlayMode("newAgent"),
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
    onSearch: () => setOverlayMode("search"),
    onBookmark: () => {
      const session = sessions[activeIndex];
      if (!session) return;
      const offset = scrollOffsets[session.id] ?? 0;
      addBookmark(session.id, offset);
      setBookmarkFlash(true);
      setTimeout(() => setBookmarkFlash(false), 1000);
    },
    onBookmarkList: () => setOverlayMode("bookmarks"),
    onSnippets: () => setOverlayMode("snippets"),
    onDiffView: () => {
      if (sessions.length >= 2) setOverlayMode("diff");
    },
    onDashboard: () => setOverlayMode("dashboard"),
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
      startAgent(agent, initialTask, resumeArgs).catch(() => {});
    }
  }, [
    initialized,
    initialTask,
    initialAgent,
    parallelAgents,
    config,
    startAgent,
    resumeArgs,
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
    if (hasOverlay || sessions.length === 0) return;

    if (key.escape && inputFocused) {
      setInputFocused(false);
      return;
    }

    if (key.return && !inputFocused) {
      setInputFocused(true);
    }
  }, { isActive: !hasOverlay });

  // Select agent from menu.
  const handleNewAgent = useCallback(
    (agentName: string) => {
      const agent = agentName.trim();
      setOverlayMode("none");
      if (!adapters.has(agent)) return;

      if (onStartFresh) {
        onStartFresh(agent);
      } else {
        startAgent(agent, "interactive").catch(() => {});
      }
    },
    [adapters, onStartFresh, startAgent]
  );

  /** Get all searchable lines for the current session */
  const getSearchLines = useCallback((): string[] => {
    if (!activeSession) return [];
    const raw = activeSession.buffer.map((b) => {
      if (b.activity) {
        switch (b.activity.kind) {
          case "text": return b.activity.text;
          case "thinking": return b.activity.text;
          case "tool_call": return `[${b.activity.toolName}] ${JSON.stringify(b.activity.input)}`;
          case "tool_result": return b.activity.content;
          case "cost": return `Done · $${b.activity.totalCost.toFixed(4)}`;
          case "init": return `Session started · ${b.activity.model}`;
          default: return b.data;
        }
      }
      return b.data;
    }).join("");
    return sanitizeTerminalText(raw).split("\n").filter((l) => l.trim().length > 0);
  }, [activeSession?.id, activeSession?.buffer.length]);

  // Dismiss error
  useInput(() => {
    if (error) clearError();
  });

  // New agent prompt
  if (overlayMode === "newAgent") {
    const availableAgents = Array.from(adapters.keys());

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Start new agent</Text>
        <Text>Available: {availableAgents.join(", ")}</Text>
        <Box marginTop={1}>
          <NewAgentPrompt
            agents={availableAgents}
            onSelect={handleNewAgent}
            onCancel={() => setOverlayMode("none")}
          />
        </Box>
      </Box>
    );
  }

  // Diff view
  if (overlayMode === "diff") {
    return (
      <DiffView
        sessions={sessions}
        onClose={() => setOverlayMode("none")}
      />
    );
  }

  // Dashboard view
  if (overlayMode === "dashboard") {
    return (
      <DashboardView
        onClose={() => setOverlayMode("none")}
      />
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

  // Bookmark count for active session
  const bookmarkCount = activeSession ? getBookmarks(activeSession.id).length : 0;

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
      {bookmarkFlash && (
        <Box paddingX={1}>
          <Text color="blue" bold>Bookmark added</Text>
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
      {/* Overlay panels */}
      {overlayMode === "search" && (
        <SearchOverlay
          lines={getSearchLines()}
          onClose={() => setOverlayMode("none")}
          onJumpToOffset={(offset) => {
            if (!activeSession) return;
            setScrollOffsets((prev) => ({ ...prev, [activeSession.id]: offset }));
          }}
        />
      )}
      {overlayMode === "bookmarks" && activeSession && (
        <BookmarkList
          sessionId={activeSession.id}
          onJump={(offset) => {
            setScrollOffsets((prev) => ({ ...prev, [activeSession.id]: offset }));
          }}
          onClose={() => setOverlayMode("none")}
        />
      )}
      {overlayMode === "snippets" && (
        <SnippetPicker
          onSelect={(prompt) => {
            setOverlayMode("none");
            if (activeSession) {
              sendInput(activeSession.id, prompt + "\n");
            }
          }}
          onClose={() => setOverlayMode("none")}
        />
      )}
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
        bookmarkCount={bookmarkCount}
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
