import React from "react";
import { Box, Text } from "ink";
import type { AgentSession } from "../hooks/useAgents.js";

interface AgentViewProps {
  session: AgentSession | undefined;
}

export function AgentView({ session }: AgentViewProps) {
  if (!session) {
    return (
      <Box
        flexDirection="column"
        flexGrow={1}
        paddingX={1}
        justifyContent="center"
        alignItems="center"
      >
        <Text bold color="yellow">
          AgentMux
        </Text>
        <Text dimColor>No agents running.</Text>
        <Text dimColor>
          Press Ctrl+N to start an agent or use: agentmux run "task"
        </Text>
      </Box>
    );
  }

  // Get last N lines of output
  const maxLines = process.stdout.rows ? process.stdout.rows - 8 : 20;
  const recentOutput = session.buffer.slice(-maxLines);

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {recentOutput.length === 0 ? (
        <Text dimColor>Waiting for output from {session.displayName}...</Text>
      ) : (
        recentOutput.map((item, i) => (
          <Text key={i} wrap="truncate">
            {item.data.replace(/\n$/, "")}
          </Text>
        ))
      )}
    </Box>
  );
}
