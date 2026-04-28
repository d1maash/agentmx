import React from "react";
import { Box, Text } from "ink";
import type { AgentProgress } from "../../adapters/types.js";
import type { AgentSession } from "../hooks/useAgents.js";

interface StatusBarProps {
  sessions: AgentSession[];
  session: AgentSession | undefined;
  focused: boolean;
  scrollOffset?: number;
  maxScrollOffset?: number;
  bookmarkCount?: number;
}

function formatUptime(ms: number, compact = false): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const secs = seconds % 60;
  if (hours > 0) {
    return compact
      ? `${hours}h${minutes % 60}m`
      : `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return compact
      ? `${minutes}m${secs}s`
      : `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

function formatCpu(cpuPercent: number | undefined): string {
  if (cpuPercent === undefined) return "--";
  return cpuPercent >= 10 ? `${cpuPercent.toFixed(0)}%` : `${cpuPercent.toFixed(1)}%`;
}

function formatMemory(memoryBytes: number | undefined): string {
  if (memoryBytes === undefined) return "--";

  const gib = 1024 * 1024 * 1024;
  const mib = 1024 * 1024;
  const kib = 1024;

  if (memoryBytes >= gib) {
    return `${(memoryBytes / gib).toFixed(1)}G`;
  }
  if (memoryBytes >= mib) {
    const value = memoryBytes / mib;
    return value >= 100 ? `${value.toFixed(0)}M` : `${value.toFixed(1)}M`;
  }
  return `${Math.max(1, Math.round(memoryBytes / kib))}K`;
}

function getProgressPercent(progress: AgentProgress | undefined): number | undefined {
  if (!progress) return undefined;
  if (typeof progress.percent === "number") {
    return Math.max(0, Math.min(100, progress.percent));
  }
  if (
    typeof progress.current === "number" &&
    typeof progress.total === "number" &&
    progress.total > 0
  ) {
    return Math.max(0, Math.min(100, (progress.current / progress.total) * 100));
  }
  return undefined;
}

function renderProgressBar(progress: AgentProgress, width: number): string {
  const normalizedWidth = Math.max(4, width);
  const percent = getProgressPercent(progress);
  if (percent !== undefined) {
    const filled = Math.round((percent / 100) * normalizedWidth);
    const empty = Math.max(0, normalizedWidth - filled);
    return `${"█".repeat(filled)}${"░".repeat(empty)}`;
  }

  const cells = Array.from({ length: normalizedWidth }, () => "░");
  const cursor = Math.floor(Date.now() / 250) % normalizedWidth;
  const span = Math.min(3, normalizedWidth);
  for (let index = 0; index < span; index += 1) {
    cells[(cursor + index) % normalizedWidth] = "█";
  }
  return cells.join("");
}

function formatProgressLabel(progress: AgentProgress | undefined): string {
  if (!progress) return "";
  const percent = getProgressPercent(progress);
  if (percent !== undefined) return `${Math.round(percent)}%`;
  return progress.label ?? "working";
}

function statusSymbol(status: AgentSession["status"]): string {
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

function statusColor(status: AgentSession["status"]): string {
  switch (status) {
    case "running":
    case "spawning":
      return "green";
    case "error":
      return "red";
    case "done":
      return "cyan";
    default:
      return "yellow";
  }
}

export function StatusBar({
  sessions,
  session,
  focused,
  scrollOffset = 0,
  maxScrollOffset = 0,
  bookmarkCount = 0,
}: StatusBarProps) {
  const columns = process.stdout.columns ?? 120;
  const compact = columns < 110;
  const showDetails = columns >= 145;
  const showProgress = columns >= 120;
  const showScrollHint = columns >= 105;
  const controls =
    columns < 90
      ? "^A ^F ^P ^B ^G ^S ^D ^N ^W ^Q"
      : compact
        ? "^A stats | ^F search | ^P fuzzy | ^B mark | ^G marks | ^S snip | ^D diff | ^N ^W ^Q"
        : "^A dashboard | ^F search | ^P fuzzy | ^B bookmark | ^G bookmarks | ^S snippets | ^D diff | ^N new | ^W kill | ^Q quit";
  const activeStatusColor = session ? statusColor(session.status) : "yellow";
  const scrollInfo =
    maxScrollOffset <= 0
      ? "Scroll: live"
      : scrollOffset <= 0
        ? "Scroll: live"
        : `Scroll: -${scrollOffset}`;
  const progressBarWidth = compact ? 8 : showDetails ? 14 : 10;
  const orderedSessions = session
    ? [session, ...sessions.filter((item) => item.id !== session.id)]
    : sessions;

  return (
    <Box flexDirection="column" paddingX={1} width="100%" overflow="hidden">
      <Text wrap="truncate">
        {session ? (
          <>
            Agent: <Text bold>{session.displayName}</Text>
            {" | "}
            Status: <Text color={activeStatusColor}>{session.status}</Text>
            {" | "}
            CPU: <Text>{formatCpu(session.cpuPercent)}</Text>
            {" | "}
            Mem: <Text>{formatMemory(session.memoryBytes)}</Text>
            {" | "}
            Uptime: <Text>{formatUptime(Date.now() - session.startedAt)}</Text>
            {showDetails && session.lastTool && session.status === "running" && (
              <>
                {" | "}
                Tool: <Text color="yellow" bold>{session.lastTool}</Text>
              </>
            )}
            {showProgress && session.progress && (
              <>
                {" | "}
                Progress:{" "}
                <Text color="cyan">{renderProgressBar(session.progress, progressBarWidth)}</Text>
                <Text> {formatProgressLabel(session.progress)}</Text>
              </>
            )}
            {showScrollHint && (
              <>
                {" | "}
                <Text dimColor>{scrollInfo}</Text>
              </>
            )}
            {bookmarkCount > 0 && (
              <>
                {" | "}
                <Text color="blue">BM:{bookmarkCount}</Text>
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
      {orderedSessions.length > 1 && (
        <Text wrap="truncate" dimColor>
          Agents:{" "}
          {orderedSessions.map((item, index) => (
            <React.Fragment key={item.id}>
              {index > 0 && " | "}
              <Text color={statusColor(item.status)}>{statusSymbol(item.status)}</Text>
              {" "}
              <Text bold={item.id === session?.id}>{item.displayName}</Text>
              {` C${formatCpu(item.cpuPercent)} M${formatMemory(item.memoryBytes)} T${formatUptime(Date.now() - item.startedAt, true)}`}
              {item.progress ? (
                <Text color="cyan">{` P${formatProgressLabel(item.progress)}`}</Text>
              ) : null}
            </React.Fragment>
          ))}
        </Text>
      )}
    </Box>
  );
}
