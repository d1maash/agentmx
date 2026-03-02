import React, { useState, useEffect } from "react";
import { Box, Text, useApp } from "ink";
import type { AgentStatus } from "../../adapters/types.js";
import type { ProcessManager } from "../../core/process-manager.js";

export interface BenchResult {
  agentName: string;
  displayName: string;
  status: AgentStatus;
  startTime: number;
  endTime?: number;
  exitCode?: number;
  outputSize: number;
  cost?: number;
}

interface BenchViewProps {
  task: string;
  processManager: ProcessManager;
  sessionIds: Map<string, string>; // agentName -> sessionId
  displayNames: Map<string, string>; // agentName -> displayName
}

function statusIcon(status: AgentStatus): string {
  switch (status) {
    case "running":
    case "spawning":
      return "⏳";
    case "done":
      return "✅";
    case "error":
      return "❌";
    default:
      return "○";
  }
}

function statusLabel(status: AgentStatus): string {
  switch (status) {
    case "spawning":
      return "starting";
    default:
      return status;
  }
}

function formatTime(ms: number): string {
  return (ms / 1000).toFixed(1) + "s";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  return (bytes / 1024).toFixed(1) + " KB";
}

function formatCost(cost: number | undefined): string {
  if (cost === undefined) return "—";
  return "$" + cost.toFixed(4);
}

function truncateTask(task: string, max: number): string {
  if (task.length <= max) return task;
  return task.slice(0, max - 1) + "…";
}

export function BenchView({
  task,
  processManager,
  sessionIds,
  displayNames,
}: BenchViewProps) {
  const { exit } = useApp();
  const [results, setResults] = useState<Map<string, BenchResult>>(new Map());
  const [allDone, setAllDone] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Poll process manager for updates
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());

      const updated = new Map<string, BenchResult>();

      for (const [agentName, sessionId] of sessionIds) {
        const proc = processManager.get(sessionId);
        if (!proc) continue;

        const session = processManager.getSession(sessionId);
        const startTime = session?.startedAt ?? Date.now();

        // Compute output size from buffer
        let outputSize = 0;
        for (const entry of proc.buffer) {
          outputSize += entry.data.length;
        }

        // Extract cost from Claude Code activity data
        let cost: number | undefined;
        for (let i = proc.buffer.length - 1; i >= 0; i--) {
          const activity = proc.buffer[i].activity;
          if (activity && activity.kind === "cost") {
            cost = activity.totalCost;
            break;
          }
        }

        const isDone = proc.status === "done" || proc.status === "error";

        updated.set(agentName, {
          agentName,
          displayName: displayNames.get(agentName) ?? agentName,
          status: proc.status,
          startTime,
          endTime: isDone ? (results.get(agentName)?.endTime ?? Date.now()) : undefined,
          exitCode: isDone ? undefined : undefined, // exitCode captured via done promise
          outputSize,
          cost,
        });
      }

      setResults(updated);

      // Check if all done
      const allFinished =
        updated.size === sessionIds.size &&
        updated.size > 0 &&
        Array.from(updated.values()).every(
          (r) => r.status === "done" || r.status === "error"
        );

      if (allFinished) {
        setAllDone(true);
      }
    }, 200);

    return () => clearInterval(interval);
  }, [processManager, sessionIds, displayNames, results]);

  // Capture exit codes and end times via done promises
  useEffect(() => {
    for (const [agentName, sessionId] of sessionIds) {
      const proc = processManager.get(sessionId);
      if (!proc) continue;

      proc.done.then(({ exitCode }) => {
        setResults((prev) => {
          const next = new Map(prev);
          const existing = next.get(agentName);
          if (existing) {
            next.set(agentName, {
              ...existing,
              exitCode,
              endTime: existing.endTime ?? Date.now(),
              status: "done",
            });
          }
          return next;
        });
      });
    }
  }, [processManager, sessionIds]);

  // Exit after showing results
  useEffect(() => {
    if (allDone) {
      const timer = setTimeout(() => exit(), 500);
      return () => clearTimeout(timer);
    }
  }, [allDone, exit]);

  const resultsList = Array.from(results.values());
  const maxNameLen = Math.max(
    ...resultsList.map((r) => r.displayName.length),
    5
  );

  if (!allDone) {
    // Live phase
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold>
          amx bench — "{truncateTask(task, 60)}"
        </Text>
        <Text>{""}</Text>
        {resultsList.map((r) => {
          const elapsed = formatTime((r.endTime ?? now) - r.startTime);
          return (
            <Text key={r.agentName}>
              {"  "}
              {r.displayName.padEnd(maxNameLen)}
              {"   "}
              {statusIcon(r.status)} {statusLabel(r.status).padEnd(8)}
              {"  "}
              {elapsed}
            </Text>
          );
        })}
      </Box>
    );
  }

  // Results phase — sort by completion time (fastest first)
  const sorted = [...resultsList].sort((a, b) => {
    const aTime = (a.endTime ?? now) - a.startTime;
    const bTime = (b.endTime ?? now) - b.startTime;
    return aTime - bTime;
  });

  const fastest = sorted[0];
  const fastestTime = fastest
    ? formatTime((fastest.endTime ?? now) - fastest.startTime)
    : "—";

  const colAgent = Math.max(maxNameLen, 5);
  const header =
    "  #  " +
    "Agent".padEnd(colAgent) +
    "   Time      Exit   Output      Cost";
  const separator = "  " + "─".repeat(header.length);

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>
        Benchmark Results — "{truncateTask(task, 50)}"
      </Text>
      <Text>{""}</Text>
      <Text dimColor>{header}</Text>
      <Text dimColor>{separator}</Text>
      {sorted.map((r, i) => {
        const elapsed = formatTime((r.endTime ?? now) - r.startTime);
        const exitStr = r.exitCode !== undefined ? String(r.exitCode) : "—";
        return (
          <Text key={r.agentName}>
            {"  "}
            {String(i + 1).padStart(1)}
            {"  "}
            {r.displayName.padEnd(colAgent)}
            {"  "}
            {elapsed.padStart(7)}
            {"  "}
            {exitStr.padStart(5)}
            {"   "}
            {formatBytes(r.outputSize).padStart(8)}
            {"  "}
            {formatCost(r.cost).padStart(8)}
          </Text>
        );
      })}
      <Text>{""}</Text>
      <Text bold color="green">
        {"  "}Fastest: {fastest?.displayName} ({fastestTime})
      </Text>
    </Box>
  );
}
