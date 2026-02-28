import React from "react";
import { Box, Text } from "ink";
import type { AgentSession } from "../hooks/useAgents.js";

interface StatusBarProps {
  session: AgentSession | undefined;
  focused: boolean;
  scrollOffset?: number;
  maxScrollOffset?: number;
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

export function StatusBar({
  session,
  focused,
  scrollOffset = 0,
  maxScrollOffset = 0,
}: StatusBarProps) {
  const columns = process.stdout.columns ?? 120;
  const compact = columns < 110;
  const showDetails = columns >= 150;
  const showScrollHint = columns >= 105;
  const controls =
    columns < 90
      ? "1-9 Enter Esc ^N ^W ^Q"
      : compact
        ? "1-9 | Enter | Esc | Ctrl+N | Ctrl+W | Ctrl+Q | ↑↓ Pg Home End"
        : "1-9 switch | Enter input | Esc close input | Ctrl+N new | Ctrl+W kill | Ctrl+Q quit | ↑↓ scroll | PgUp/PgDn | Home/End";
  const statusColor =
    session?.status === "running"
      ? "green"
      : session?.status === "error"
        ? "red"
        : "yellow";
  const scrollInfo =
    maxScrollOffset <= 0
      ? "Scroll: live"
      : scrollOffset <= 0
        ? "Scroll: live"
        : `Scroll: -${scrollOffset}`;

  return (
    <Box paddingX={1} width="100%" overflow="hidden">
      <Text wrap="truncate">
        {session ? (
          <>
            Agent: <Text bold>{session.displayName}</Text>
            {" | "}
            Status: <Text color={statusColor}>{session.status}</Text>
            {!compact && (
              <>
                {" | "}
                Uptime: <Text>{formatUptime(Date.now() - session.startedAt)}</Text>
              </>
            )}
            {showDetails && session.lastTool && session.status === "running" && (
              <>
                {" | "}
                Tool: <Text color="yellow" bold>{session.lastTool}</Text>
              </>
            )}
            {showScrollHint && (
              <>
                {" | "}
                <Text dimColor>{scrollInfo}</Text>
              </>
            )}
          </>
        ) : (
          <>No agent selected</>
        )}
        {" | "}
        <Text dimColor>{focused ? "INPUT" : "VIEW"}</Text>
        {" | "}
        <Text dimColor>{controls}</Text>
      </Text>
    </Box>
  );
}
