import React from "react";
import { Box, Text } from "ink";
import type { AgentSession } from "../hooks/useAgents.js";

interface AgentTabsProps {
  sessions: AgentSession[];
  activeIndex: number;
}

function truncateLabel(label: string, max: number): string {
  if (max <= 0) return "";
  if (label.length <= max) return label;
  if (max <= 3) return label.slice(0, max);
  return `${label.slice(0, max - 3)}...`;
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

  const columns = process.stdout.columns ?? 120;
  const perTabBudget = Math.max(
    8,
    Math.floor((columns - 4 - sessions.length) / Math.max(1, sessions.length))
  );

  return (
    <Box paddingX={1} gap={1} flexWrap="nowrap" overflow="hidden" width="100%">
      {sessions.map((session, index) => {
        const isActive = index === activeIndex;
        const color = statusColor(session.status);
        const symbol = statusSymbol(session.status);
        const num = index + 1;
        const label = truncateLabel(`${num}:${session.displayName}`, perTabBudget);

        return (
          <Box key={session.id}>
            {isActive ? (
              <Text bold inverse color="white" backgroundColor="blue">
                {" "}
                <Text color={color}>{symbol}</Text> {label}{" "}
              </Text>
            ) : (
              <Text dimColor={session.status === "done"}>
                {" "}
                <Text color={color}>{symbol}</Text> {label}{" "}
              </Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
