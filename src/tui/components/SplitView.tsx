import React from "react";
import { Box, Text } from "ink";
import type { AgentSession } from "../hooks/useAgents.js";
import { AgentView } from "./AgentView.js";

interface SplitViewProps {
  sessions: AgentSession[];
  direction: "vertical" | "horizontal";
}

function AgentPane({ session }: { session: AgentSession }) {
  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      width="100%"
      overflow="hidden"
      borderStyle="single"
      borderColor="gray"
    >
      <Box paddingX={1}>
        <Text bold color="cyan">
          {session.displayName}
        </Text>
        <Text dimColor> ({session.status})</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} width="100%" overflow="hidden">
        <AgentView session={session} />
      </Box>
    </Box>
  );
}

export function SplitView({ sessions, direction }: SplitViewProps) {
  return (
    <Box
      flexDirection={direction === "vertical" ? "row" : "column"}
      flexGrow={1}
      width="100%"
      overflow="hidden"
    >
      {sessions.map((session) => (
        <AgentPane key={session.id} session={session} />
      ))}
    </Box>
  );
}
