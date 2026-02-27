import React from "react";
import { Box, Text } from "ink";
import type { AgentSession } from "../hooks/useAgents.js";

interface SplitViewProps {
  sessions: AgentSession[];
  direction: "vertical" | "horizontal";
}

function AgentPane({ session }: { session: AgentSession }) {
  const maxLines = 15;
  const recentOutput = session.buffer.slice(-maxLines);

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
    >
      <Box>
        <Text bold color="cyan">
          {session.displayName}
        </Text>
        <Text dimColor> ({session.status})</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {recentOutput.length === 0 ? (
          <Text dimColor>Waiting for output...</Text>
        ) : (
          recentOutput.map((item, i) => (
            <Text key={i} wrap="truncate">
              {item.data.replace(/\n$/, "")}
            </Text>
          ))
        )}
      </Box>
    </Box>
  );
}

export function SplitView({ sessions, direction }: SplitViewProps) {
  return (
    <Box
      flexDirection={direction === "vertical" ? "row" : "column"}
      flexGrow={1}
    >
      {sessions.map((session) => (
        <AgentPane key={session.id} session={session} />
      ))}
    </Box>
  );
}
