import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import type { AgentSession } from "../hooks/useAgents.js";
import { sanitizeTerminalText } from "../utils/terminal.js";

interface DiffViewProps {
  sessions: AgentSession[];
  onClose: () => void;
}

/** Extract plain text lines from agent output buffer */
function extractLines(session: AgentSession): string[] {
  const raw = session.buffer.map((b) => {
    if (b.activity) {
      switch (b.activity.kind) {
        case "text":
          return b.activity.text;
        case "thinking":
          return `[thinking] ${b.activity.text}`;
        case "tool_call":
          return `[${b.activity.toolName}]`;
        case "tool_result":
          return `  -> ${b.activity.content}`;
        case "cost":
          return `Done · $${b.activity.totalCost.toFixed(4)}`;
        case "init":
          return `Session started · ${b.activity.model}`;
        default:
          return b.data;
      }
    }
    return b.data;
  }).join("");
  return sanitizeTerminalText(raw).split("\n").filter((l) => l.trim().length > 0);
}

interface DiffLine {
  type: "same" | "added" | "removed" | "changed";
  left: string;
  right: string;
}

/** Simple line-by-line diff between two sets of lines */
function computeDiff(leftLines: string[], rightLines: string[]): DiffLine[] {
  const maxLen = Math.max(leftLines.length, rightLines.length);
  const result: DiffLine[] = [];

  for (let i = 0; i < maxLen; i++) {
    const left = leftLines[i] ?? "";
    const right = rightLines[i] ?? "";

    if (left === right) {
      result.push({ type: "same", left, right });
    } else if (!left && right) {
      result.push({ type: "added", left: "", right });
    } else if (left && !right) {
      result.push({ type: "removed", left, right: "" });
    } else {
      result.push({ type: "changed", left, right });
    }
  }
  return result;
}

export function DiffView({ sessions, onClose }: DiffViewProps) {
  const [leftIdx, setLeftIdx] = useState(0);
  const [rightIdx, setRightIdx] = useState(Math.min(1, sessions.length - 1));
  const [scrollOffset, setScrollOffset] = useState(0);
  const [selecting, setSelecting] = useState<"left" | "right" | null>(null);

  const leftSession = sessions[leftIdx];
  const rightSession = sessions[rightIdx];

  const diff = useMemo(() => {
    if (!leftSession || !rightSession) return [];
    const leftLines = extractLines(leftSession);
    const rightLines = extractLines(rightSession);
    return computeDiff(leftLines, rightLines);
  }, [
    leftSession?.id,
    rightSession?.id,
    leftSession?.buffer.length,
    rightSession?.buffer.length,
  ]);

  const rows = Math.max(1, (process.stdout.rows ?? 30) - 10);
  const cols = Math.max(40, (process.stdout.columns ?? 120));
  const halfCol = Math.floor((cols - 3) / 2);

  const maxOffset = Math.max(0, diff.length - rows);
  const effectiveOffset = Math.min(scrollOffset, maxOffset);
  const visibleDiff = diff.slice(effectiveOffset, effectiveOffset + rows);

  useInput((input, key) => {
    if (selecting) {
      // Agent selection mode
      if (key.escape) {
        setSelecting(null);
        return;
      }
      if (key.upArrow || key.downArrow) {
        const current = selecting === "left" ? leftIdx : rightIdx;
        const next = key.upArrow
          ? Math.max(0, current - 1)
          : Math.min(sessions.length - 1, current + 1);
        if (selecting === "left") setLeftIdx(next);
        else setRightIdx(next);
        return;
      }
      if (key.return) {
        setSelecting(null);
        return;
      }
      return;
    }

    if (key.escape) {
      onClose();
      return;
    }

    if (key.upArrow) {
      setScrollOffset((o) => Math.max(0, o - 1));
      return;
    }

    if (key.downArrow) {
      setScrollOffset((o) => Math.min(maxOffset, o + 1));
      return;
    }

    if (key.pageUp) {
      setScrollOffset((o) => Math.max(0, o - rows));
      return;
    }

    if (key.pageDown) {
      setScrollOffset((o) => Math.min(maxOffset, o + rows));
      return;
    }

    // 'l' to select left agent, 'r' to select right agent
    if (input === "l" && !key.ctrl) {
      setSelecting("left");
      return;
    }
    if (input === "r" && !key.ctrl) {
      setSelecting("right");
      return;
    }
  });

  const colorForType = (type: DiffLine["type"]) => {
    switch (type) {
      case "added": return "green";
      case "removed": return "red";
      case "changed": return "yellow";
      default: return undefined;
    }
  };

  const symbolForType = (type: DiffLine["type"]) => {
    switch (type) {
      case "added": return "+";
      case "removed": return "-";
      case "changed": return "~";
      default: return " ";
    }
  };

  if (selecting) {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
        <Text bold color="cyan">Select {selecting} agent</Text>
        {sessions.map((s, i) => {
          const current = selecting === "left" ? leftIdx : rightIdx;
          return (
            <Text key={s.id} inverse={i === current}>
              {i === current ? " > " : "   "}{s.displayName}
            </Text>
          );
        })}
        <Text dimColor>↑/↓ select | Enter confirm | Esc cancel</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height="100%" width="100%" overflow="hidden">
      {/* Header */}
      <Box paddingX={1} gap={1}>
        <Text bold color="cyan">Diff View</Text>
        <Text dimColor>|</Text>
        <Text>
          Left: <Text bold color="green">{leftSession?.displayName ?? "none"}</Text>
        </Text>
        <Text dimColor>|</Text>
        <Text>
          Right: <Text bold color="blue">{rightSession?.displayName ?? "none"}</Text>
        </Text>
        <Text dimColor>|</Text>
        <Text dimColor>
          {diff.filter((d) => d.type !== "same").length} differences
        </Text>
      </Box>

      {/* Column headers */}
      <Box paddingX={1}>
        <Box width={halfCol}>
          <Text bold color="green">{truncatePad(leftSession?.displayName ?? "", halfCol - 2)}</Text>
        </Box>
        <Text dimColor> │ </Text>
        <Box width={halfCol}>
          <Text bold color="blue">{truncatePad(rightSession?.displayName ?? "", halfCol - 2)}</Text>
        </Box>
      </Box>

      {/* Diff lines */}
      <Box
        flexDirection="column"
        flexGrow={1}
        borderStyle="single"
        borderColor="gray"
        overflow="hidden"
        width="100%"
      >
        {visibleDiff.length === 0 ? (
          <Box paddingX={1}>
            <Text dimColor>No output to compare yet.</Text>
          </Box>
        ) : (
          visibleDiff.map((line, i) => (
            <Box key={effectiveOffset + i} paddingX={0}>
              <Text color={colorForType(line.type)}>{symbolForType(line.type)}</Text>
              <Box width={halfCol - 1}>
                <Text
                  color={line.type === "removed" || line.type === "changed" ? "red" : undefined}
                  dimColor={line.type === "added"}
                  wrap="truncate"
                >
                  {truncatePad(line.left, halfCol - 2)}
                </Text>
              </Box>
              <Text dimColor>│</Text>
              <Box width={halfCol - 1}>
                <Text
                  color={line.type === "added" || line.type === "changed" ? "green" : undefined}
                  dimColor={line.type === "removed"}
                  wrap="truncate"
                >
                  {truncatePad(line.right, halfCol - 2)}
                </Text>
              </Box>
            </Box>
          ))
        )}
      </Box>

      {/* Footer */}
      <Box paddingX={1}>
        <Text dimColor>
          ↑/↓ scroll | PgUp/PgDn | l/r select agents | Esc close
          {maxOffset > 0 ? ` | ${effectiveOffset + 1}-${Math.min(effectiveOffset + rows, diff.length)}/${diff.length}` : ""}
        </Text>
      </Box>
    </Box>
  );
}

function truncatePad(s: string, width: number): string {
  if (width <= 0) return "";
  if (s.length > width) return s.slice(0, width - 1) + "…";
  return s + " ".repeat(width - s.length);
}
