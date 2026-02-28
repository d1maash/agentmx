import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { AgentSession } from "../hooks/useAgents.js";
import type { ClaudeActivity, AgentOutput } from "../../adapters/types.js";
import { getRecentTerminalLines } from "../utils/terminal.js";

interface AgentViewProps {
  session: AgentSession | undefined;
}

function getLines(session: AgentSession, maxLines: number): string[] {
  const raw = session.buffer.map((b) => b.data).join("");
  return getRecentTerminalLines(raw, maxLines);
}

/** Check if a session has activity metadata (Claude Code stream-json) */
function hasActivityData(session: AgentSession): boolean {
  return session.agentName === "claude-code" &&
    session.buffer.some((b) => b.activity !== undefined);
}

/** Render a single activity item with appropriate colors */
function ActivityItem({ item }: { item: AgentOutput }) {
  const activity = item.activity as ClaudeActivity;
  if (!activity) {
    return <Text wrap="truncate">{item.data.trimEnd()}</Text>;
  }

  switch (activity.kind) {
    case "init":
      return (
        <Text dimColor wrap="truncate">
          ● Session started · {activity.model}
        </Text>
      );

    case "tool_call": {
      const label = `[${activity.toolName}]`;
      const detail = formatToolDetail(activity.toolName, activity.input);
      return (
        <Text wrap="truncate">
          <Text color="yellow" bold>{label}</Text>
          <Text> {detail}</Text>
        </Text>
      );
    }

    case "tool_result":
      return (
        <Text dimColor wrap="truncate">
          {"  → "}{truncateStr(activity.content.replace(/\n/g, " "), 100)}
        </Text>
      );

    case "text":
      return (
        <Text wrap="truncate">
          {activity.text.trimEnd()}
        </Text>
      );

    case "cost":
      return (
        <Text color="cyan" wrap="truncate">
          ✓ Done · ${activity.totalCost.toFixed(4)} · {(activity.durationMs / 1000).toFixed(1)}s
        </Text>
      );

    default:
      return <Text wrap="truncate">{item.data.trimEnd()}</Text>;
  }
}

function formatToolDetail(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "Read":
    case "Write":
    case "Edit":
      return String(input.file_path ?? "");
    case "Bash":
      return truncateStr(String(input.command ?? ""), 80);
    case "Glob":
      return String(input.pattern ?? "");
    case "Grep":
      return String(input.pattern ?? "");
    case "WebSearch":
      return String(input.query ?? "");
    case "WebFetch":
      return String(input.url ?? "");
    case "Task":
      return truncateStr(String(input.description ?? input.prompt ?? ""), 60);
    default:
      return "";
  }
}

function truncateStr(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** Renders structured activity view for Claude Code */
function ActivityView({ session }: { session: AgentSession }) {
  const maxItems = process.stdout.rows ? process.stdout.rows - 8 : 20;
  const items = useMemo(() => {
    const withActivity = session.buffer.filter((b) => b.activity !== undefined);
    return withActivity.slice(-Math.max(1, maxItems));
  }, [session.buffer.length, maxItems]);

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {items.length === 0 ? (
        <Text dimColor>Waiting for output from {session.displayName}...</Text>
      ) : (
        items.map((item, i) => <ActivityItem key={i} item={item} />)
      )}
    </Box>
  );
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

/** Renders live output for an active session (raw text fallback) */
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
  if (hasActivityData(session)) {
    return <ActivityView session={session} />;
  }
  return <SessionView session={session} />;
}
