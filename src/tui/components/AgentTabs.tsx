import React from "react";
import { Box, Text } from "ink";
import type { AgentSession } from "../hooks/useAgents.js";

interface AgentTabsProps {
  sessions: AgentSession[];
  activeIndex: number;
}

function statusIndicator(status: string): { symbol: string; color: string } {
  switch (status) {
    case "running":
    case "spawning":
      return { symbol: "●", color: "green" };
    case "idle":
      return { symbol: "○", color: "gray" };
    case "error":
      return { symbol: "●", color: "red" };
    case "done":
      return { symbol: "✓", color: "cyan" };
    default:
      return { symbol: "○", color: "gray" };
  }
}

export function AgentTabs({ sessions, activeIndex }: AgentTabsProps) {
  if (sessions.length === 0) {
    return (
      <Box paddingX={1}>
        <Text dimColor>No active agents. Press Ctrl+N to start one.</Text>
      </Box>
    );
  }

  return (
    <Box paddingX={1} gap={1}>
      {sessions.map((session, index) => {
        const isActive = index === activeIndex;
        const { symbol, color } = statusIndicator(session.status);
        const taskPreview =
          session.task.length > 20
            ? session.task.slice(0, 20) + "…"
            : session.task;

        return (
          <Box key={session.id}>
            <Text
              bold={isActive}
              inverse={isActive}
              color={isActive ? "white" : undefined}
              backgroundColor={isActive ? "blue" : undefined}
            >
              {" "}
              <Text color={color}>{symbol}</Text> {session.displayName}
              {taskPreview ? `: ${taskPreview}` : ""}{" "}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
