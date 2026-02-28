import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { AgentSession } from "../hooks/useAgents.js";

interface AgentViewProps {
  session: AgentSession | undefined;
}

/**
 * Strip ANSI cursor-movement / screen-clear sequences that break Ink rendering,
 * but keep color/style codes (SGR) intact.
 */
function stripCursorSequences(s: string): string {
  // Remove cursor movement, erase line/screen, cursor show/hide, etc.
  // Keep SGR (color) sequences: \x1b[...m
  return s.replace(/\x1b\[[\d;]*[ABCDEFGHJKSTfnsu]/g, "")
          .replace(/\x1b\[\?[\d;]*[hl]/g, "")
          .replace(/\x1b\[[\d;]*X/g, "");
}

/**
 * Concatenate all buffer chunks and split into terminal lines.
 * Handles \r (carriage return) by keeping only the last overwrite.
 * Preserves ANSI color codes within each line for proper styling.
 */
function getLines(session: AgentSession, maxLines: number): string[] {
  // Join all raw PTY output into one string
  const raw = session.buffer.map((b) => b.data).join("");

  // Strip cursor-movement sequences that break Ink
  const cleaned = stripCursorSequences(raw);

  // Split by newlines (handle \r\n, \n, and bare \r)
  const lines = cleaned.split(/\r?\n|\r/);

  // Take last N non-empty lines
  const filtered = lines.filter((l) => l.trim().length > 0);
  return filtered.slice(-maxLines);
}

/** Shown when no session is active */
function EmptyView() {
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

/** Renders live output for an active session */
function SessionView({ session }: { session: AgentSession }) {
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

export function AgentView({ session }: AgentViewProps) {
  if (!session) {
    return <EmptyView />;
  }
  return <SessionView session={session} />;
}
