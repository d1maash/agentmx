import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { AgentSession } from "../hooks/useAgents.js";

interface AgentViewProps {
  session: AgentSession | undefined;
}

/**
 * Concatenate all buffer chunks and split into terminal lines.
 * Preserves ANSI color codes within each line for proper styling.
 */
function getLines(session: AgentSession, maxLines: number): string[] {
  // Join all raw PTY output into one string
  const raw = session.buffer.map((b) => b.data).join("");

  // Split by newlines, keeping ANSI codes intact
  const lines = raw.split(/\r?\n/);

  // Take last N non-empty lines
  const filtered = lines.filter((l) => l.trim().length > 0);
  return filtered.slice(-maxLines);
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
          Press Ctrl+N to start an agent or use: agentmux run {"\"task\""}
        </Text>
      </Box>
    );
  }

  const maxLines = process.stdout.rows ? process.stdout.rows - 8 : 20;
  const lines = useMemo(
    () => getLines(session, maxLines),
    [session.buffer.length, maxLines]
  );

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {lines.length === 0 ? (
        <Text dimColor>Waiting for output from {session.displayName}...</Text>
      ) : (
        lines.map((line, i) => (
          <Text key={i} wrap="truncate">
            {line}
          </Text>
        ))
      )}
    </Box>
  );
}
