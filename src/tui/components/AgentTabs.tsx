import React from "react";
import { Box, Text } from "ink";
import type { AgentSession } from "../hooks/useAgents.js";

interface AgentTabsProps {
  sessions: AgentSession[];
  activeIndex: number;
}

function statusColor(status: string): string {
  switch (status) {
    case "running":
    case "spawning":
      return "green";
    case "error":
      return "red";
    case "done":
      return "cyan";
    default:
      return "gray";
  }
}

function statusSymbol(status: string): string {
  switch (status) {
    case "running":
    case "spawning":
      return "●";
    case "error":
      return "✗";
    case "done":
      return "✓";
    default:
      return "○";
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
        const color = statusColor(session.status);
        const symbol = statusSymbol(session.status);
        const num = index + 1;

        return (
          <Box key={session.id}>
            {isActive ? (
              <Text bold inverse color="white" backgroundColor="blue">
                {" "}
                <Text color={color}>{symbol}</Text> {num}:{session.displayName}{" "}
              </Text>
            ) : (
              <Text dimColor={session.status === "done"}>
                {" "}
                <Text color={color}>{symbol}</Text> {num}:{session.displayName}{" "}
              </Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
