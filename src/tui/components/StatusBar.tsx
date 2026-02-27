import React from "react";
import { Box, Text } from "ink";
import type { AgentSession } from "../hooks/useAgents.js";

interface StatusBarProps {
  session: AgentSession | undefined;
  focused: boolean;
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

export function StatusBar({ session }: StatusBarProps) {
  return (
    <Box paddingX={1} justifyContent="space-between">
      <Box gap={2}>
        {session ? (
          <>
            <Text>
              Agent: <Text bold>{session.displayName}</Text>
            </Text>
            <Text>
              Status:{" "}
              <Text
                color={
                  session.status === "running"
                    ? "green"
                    : session.status === "error"
                      ? "red"
                      : "yellow"
                }
              >
                {session.status}
              </Text>
            </Text>
            <Text>
              Uptime:{" "}
              <Text>{formatUptime(Date.now() - session.startedAt)}</Text>
            </Text>
          </>
        ) : (
          <Text dimColor>No agent selected</Text>
        )}
      </Box>
      <Box gap={1}>
        <Text dimColor>
          1-9 switch | Enter {session?.status === "done" || session?.status === "error" ? "restart" : "focus"} | Ctrl+N new | Ctrl+W kill | Ctrl+Q quit
        </Text>
      </Box>
    </Box>
  );
}
