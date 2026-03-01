import React, { useEffect, useMemo } from "react";
import { Box, Text } from "ink";
import type { AgentSession } from "../hooks/useAgents.js";
import type { ClaudeActivity } from "../../adapters/types.js";
import { getTerminalViewportLinesFromOutputBuffer } from "../utils/terminal.js";

interface AgentViewProps {
  session: AgentSession | undefined;
  scrollOffset?: number;
  onScrollInfo?: (info: ScrollInfo) => void;
}

export interface ScrollInfo {
  totalItems: number;
  maxOffset: number;
  effectiveOffset: number;
}

const VIEW_RESERVED_LINES = 10;

function toSingleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Check if a session has activity metadata (Claude Code stream-json) */
function hasActivityData(session: AgentSession): boolean {
  return session.agentName === "claude-code" &&
    session.buffer.some((b) => b.activity !== undefined);
}

/** A single visual line to render — all lines are exactly 1 terminal row */
type VisualLine =
  | { kind: "text-line"; text: string; streaming: boolean }
  | { kind: "thinking-line"; text: string; streaming: boolean }
  | { kind: "item"; activity?: ClaudeActivity; data: string };

/** Split buffer items into visual lines (1 line = 1 terminal row) */
function flattenToVisualLines(items: AgentOutput[], cols: number): VisualLine[] {
  const lines: VisualLine[] = [];
  const wrapWidth = Math.max(20, cols);

  for (const item of items) {
    const act = item.activity;

    if (act?.kind === "text" || act?.kind === "thinking") {
      const text = act.text.trimEnd();
      const lineKind = act.kind === "thinking" ? "thinking-line" as const : "text-line" as const;

      if (!text) {
        if (act.streaming) {
          lines.push({ kind: lineKind, text: act.kind === "thinking" ? "thinking..." : "...", streaming: true });
        }
        continue;
      }

      // Split into visual lines: first by \n, then wrap long lines
      for (const raw of text.split("\n")) {
        if (raw.length <= wrapWidth) {
          lines.push({ kind: lineKind, text: raw, streaming: false });
        } else {
          for (let i = 0; i < raw.length; i += wrapWidth) {
            lines.push({ kind: lineKind, text: raw.slice(i, i + wrapWidth), streaming: false });
          }
        }
      }
      // Mark last line as streaming if active
      if (act.streaming && lines.length > 0) {
        const last = lines[lines.length - 1];
        if (last.kind === lineKind) last.streaming = true;
      }
    } else {
      // tool_call, tool_result, init, cost, raw text — always 1 line
      lines.push({ kind: "item", activity: act, data: item.data });
    }
  }

  return lines;
}

/** Render a single visual line */
function VisualLineView({ line }: { line: VisualLine }) {
  if (line.kind === "text-line") {
    return (
      <Text wrap="truncate">
        {line.text}{line.streaming ? " ..." : ""}
      </Text>
    );
  }

  if (line.kind === "thinking-line") {
    return (
      <Text dimColor italic wrap="truncate">
        {line.text}{line.streaming ? " ..." : ""}
      </Text>
    );
  }

  // kind === "item" — single-line activity items
  const { activity, data } = line;
  if (!activity) {
    return <Text wrap="truncate">{toSingleLine(data)}</Text>;
  }

  switch (activity.kind) {
    case "init":
      return (
        <Text dimColor wrap="truncate">
          Session started · {activity.model}
        </Text>
      );

    case "tool_call": {
      const label = `[${activity.toolName}]`;
      const detail = formatToolDetail(activity.toolName, activity.input);
      return (
        <Text wrap="truncate">
          <Text color="yellow" bold>{label}</Text>
          <Text> {detail || (activity.streaming ? "..." : "")}</Text>
        </Text>
      );
    }

    case "tool_result":
      return (
        <Text dimColor wrap="truncate">
          {"  -> "}{truncateStr(activity.content.replace(/\n/g, " "), 100)}
        </Text>
      );

    case "cost":
      return (
        <Text color="cyan" wrap="truncate">
          Done · ${activity.totalCost.toFixed(4)} · {(activity.durationMs / 1000).toFixed(1)}s
        </Text>
      );

    default:
      return <Text wrap="truncate">{toSingleLine(data)}</Text>;
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

/** Renders structured activity view for Claude Code (line-based) */
function ActivityView({
  session,
  scrollOffset,
  onScrollInfo,
}: {
  session: AgentSession;
  scrollOffset: number;
  onScrollInfo?: (info: ScrollInfo) => void;
}) {
  const maxLines = Math.max(1, (process.stdout.rows ?? 30) - VIEW_RESERVED_LINES);
  const cols = Math.max(20, (process.stdout.columns ?? 80) - 4);

  // Flatten buffer items into visual lines (1 line = 1 terminal row)
  // No useMemo — buffer entries are mutated in-place for streaming updates
  const allLines = flattenToVisualLines(session.buffer, cols);
  const totalLines = allLines.length;
  const maxOffset = Math.max(0, totalLines - maxLines);
  const effectiveOffset = Math.min(Math.max(0, scrollOffset), maxOffset);
  const start = Math.max(0, totalLines - maxLines - effectiveOffset);
  const end = Math.min(totalLines, start + maxLines);
  const visibleLines = allLines.slice(start, end);

  useEffect(() => {
    onScrollInfo?.({ totalItems: totalLines, maxOffset, effectiveOffset });
  }, [onScrollInfo, totalLines, maxOffset, effectiveOffset]);

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      paddingX={1}
      overflow="hidden"
      width="100%"
    >
      {visibleLines.length === 0 ? (
        <Text dimColor>Waiting for output from {session.displayName}...</Text>
      ) : (
        visibleLines.map((vl, i) => <VisualLineView key={i} line={vl} />)
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

function CodexLine({ line }: { line: string }) {
  if (!line.startsWith("[codex]")) {
    return <Text wrap="wrap">{line}</Text>;
  }

  const reasoning = line.match(/^\[codex\]\[reasoning\]\s*(.*)$/);
  if (reasoning) {
    return (
      <Text wrap="wrap">
        <Text color="cyan" bold>[codex][reasoning]</Text>
        {reasoning[1] ? (
          <Text dimColor italic> {reasoning[1]}</Text>
        ) : null}
      </Text>
    );
  }

  const commandStart = line.match(/^\[codex\]\[command:start\]\s*(.*)$/);
  if (commandStart) {
    return (
      <Text wrap="wrap">
        <Text color="yellow" bold>[codex][command:start]</Text>
        {commandStart[1] ? <Text> {commandStart[1]}</Text> : null}
      </Text>
    );
  }

  const commandEnd = line.match(/^\[codex\]\[command:end\]\s+exit=([^\s]+)\s*(.*)$/);
  if (commandEnd) {
    const exitCode = commandEnd[1];
    const ok = exitCode === "0";
    return (
      <Text wrap="wrap">
        <Text color={ok ? "green" : "red"} bold>[codex][command:end]</Text>
        <Text> exit=</Text>
        <Text color={ok ? "green" : "red"}>{exitCode}</Text>
        {commandEnd[2] ? <Text> {commandEnd[2]}</Text> : null}
      </Text>
    );
  }

  const commandOutput = line.match(/^\[codex\]\[command:output\]\s*(.*)$/);
  if (commandOutput) {
    return (
      <Text wrap="wrap">
        <Text color="blue" bold>[codex][command:output]</Text>
        {commandOutput[1] ? <Text> {commandOutput[1]}</Text> : null}
      </Text>
    );
  }

  const sessionStarted = line.match(/^\[codex\]\s*(Session started:.*)$/);
  if (sessionStarted) {
    return (
      <Text wrap="wrap">
        <Text color="cyan" bold>[codex]</Text>
        <Text color="cyan"> {sessionStarted[1]}</Text>
      </Text>
    );
  }

  const turnComplete = line.match(/^\[codex\]\s*(Turn complete.*)$/);
  if (turnComplete) {
    return (
      <Text wrap="wrap">
        <Text color="green" bold>[codex]</Text>
        <Text color="green"> {turnComplete[1]}</Text>
      </Text>
    );
  }

  const approval = line.match(/^\[codex\]\s*(Approval required.*)$/);
  if (approval) {
    return (
      <Text wrap="wrap">
        <Text color="yellow" bold>[codex]</Text>
        <Text color="yellow"> {approval[1]}</Text>
      </Text>
    );
  }

  const waitingInput = line.match(/^\[codex\]\s*(Waiting for your input.*)$/);
  if (waitingInput) {
    return (
      <Text wrap="wrap">
        <Text color="magenta" bold>[codex]</Text>
        <Text color="magenta"> {waitingInput[1]}</Text>
      </Text>
    );
  }

  const planStep = line.match(/^\[codex\]\s*(Plan-related.*)$/);
  if (planStep) {
    return (
      <Text wrap="wrap">
        <Text color="blue" bold>[codex]</Text>
        <Text color="blue"> {planStep[1]}</Text>
      </Text>
    );
  }

  if (/^\[codex\]\s*Working\.\.\.$/.test(line)) {
    return (
      <Text wrap="wrap">
        <Text color="blue" bold>[codex]</Text>
        <Text color="blue"> Working...</Text>
      </Text>
    );
  }

  const generic = line.match(/^(\[codex\](?:\[[^\]]+\])?)\s*(.*)$/);
  if (generic) {
    return (
      <Text wrap="wrap">
        <Text color="cyan" bold>{generic[1]}</Text>
        {generic[2] ? <Text> {generic[2]}</Text> : null}
      </Text>
    );
  }

  return <Text wrap="wrap">{line}</Text>;
}

/** Renders live output for an active session (raw text fallback) */
function SessionView({
  session,
  scrollOffset,
  onScrollInfo,
}: {
  session: AgentSession;
  scrollOffset: number;
  onScrollInfo?: (info: ScrollInfo) => void;
}) {
  const maxLines = Math.max(1, (process.stdout.rows ?? 30) - VIEW_RESERVED_LINES);
  const viewport = useMemo(
    () => getTerminalViewportLinesFromOutputBuffer(session.buffer, maxLines, scrollOffset),
    [session.id, session.buffer.length, maxLines, scrollOffset]
  );
  const lines = viewport.lines;
  const isCodex = session.agentName === "codex";

  useEffect(() => {
    onScrollInfo?.({
      totalItems: viewport.totalLines,
      maxOffset: viewport.maxOffset,
      effectiveOffset: viewport.effectiveOffset,
    });
  }, [
    onScrollInfo,
    viewport.totalLines,
    viewport.maxOffset,
    viewport.effectiveOffset,
  ]);

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      paddingX={1}
      overflow="hidden"
      width="100%"
    >
      {lines.length === 0 ? (
        <Text dimColor>Waiting for output from {session.displayName}...</Text>
      ) : (
        lines.map((line, i) => (
          isCodex ? <CodexLine key={i} line={line} /> : (
            <Text key={i} wrap="truncate">
              {line}
            </Text>
          )
        ))
      )}
    </Box>
  );
}

export function AgentView({
  session,
  scrollOffset = 0,
  onScrollInfo,
}: AgentViewProps) {
  if (!session) {
    return <EmptyView />;
  }
  if (hasActivityData(session)) {
    return (
      <ActivityView
        session={session}
        scrollOffset={scrollOffset}
        onScrollInfo={onScrollInfo}
      />
    );
  }
  return (
    <SessionView
      session={session}
      scrollOffset={scrollOffset}
      onScrollInfo={onScrollInfo}
    />
  );
}
