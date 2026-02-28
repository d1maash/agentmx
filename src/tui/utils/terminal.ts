const ANSI_CSI_RE = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const ANSI_OSC_RE = /\x1B\][^\x07]*(?:\x07|\x1B\\)/g;
const ANSI_ESC_RE = /\x1B[@-Z\\-_]/g;
const CONTROL_RE = /[\x00-\x07\x0b\x0c\x0e-\x1f\x7f]/g;

const RECENT_SCAN_CHAR_LIMIT = 120_000;
const RECENT_SCAN_MIN_CHUNKS = 24;
const RECENT_SCAN_LINE_MULTIPLIER = 4;
const RECENT_SCAN_CHAR_HARD_LIMIT = 2_000_000;

function countNewlines(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) count += 1;
  }
  return count;
}

function normalizeCarriageReturns(input: string): string {
  const lines: string[] = [];
  let current = "";

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === "\r") {
      current = "";
      continue;
    }
    if (ch === "\n") {
      lines.push(current);
      current = "";
      continue;
    }
    if (ch === "\b") {
      current = current.slice(0, -1);
      continue;
    }
    current += ch;
  }

  lines.push(current);
  return lines.join("\n");
}

export function sanitizeTerminalText(raw: string): string {
  const withoutAnsi = raw
    .replace(/\r\n/g, "\n")
    .replace(ANSI_OSC_RE, "")
    .replace(ANSI_CSI_RE, "")
    .replace(ANSI_ESC_RE, "")
    .replace(CONTROL_RE, "")
    .replace(/\t/g, "    ");

  return normalizeCarriageReturns(withoutAnsi);
}

export function getRecentTerminalLines(raw: string, maxLines: number): string[] {
  if (!raw) return [];

  const cleaned = sanitizeTerminalText(raw);
  const lines = cleaned
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  return lines.slice(-Math.max(1, maxLines));
}

export function getRecentTerminalLinesFromChunks(
  chunks: readonly string[],
  maxLines: number
): string[] {
  return getRecentTerminalLinesFromOutputBuffer(
    chunks.map((data) => ({ data })),
    maxLines
  );
}

export function getRecentTerminalLinesFromOutputBuffer(
  outputs: readonly { data: string }[],
  maxLines: number
): string[] {
  const viewport = getTerminalViewportLinesFromOutputBuffer(outputs, maxLines, 0);
  return viewport.lines;
}

export interface TerminalViewport {
  lines: string[];
  totalLines: number;
  maxOffset: number;
  effectiveOffset: number;
}

export function getTerminalViewportLinesFromOutputBuffer(
  outputs: readonly { data: string }[],
  visibleLines: number,
  scrollOffset: number
): TerminalViewport {
  if (outputs.length === 0) {
    return {
      lines: [],
      totalLines: 0,
      maxOffset: 0,
      effectiveOffset: 0,
    };
  }

  const safeVisibleLines = Math.max(1, visibleLines);
  const safeScrollOffset = Math.max(0, scrollOffset);
  const targetLines =
    (safeVisibleLines + safeScrollOffset + 1) * RECENT_SCAN_LINE_MULTIPLIER;
  const dynamicCharLimit = Math.min(
    RECENT_SCAN_CHAR_HARD_LIMIT,
    Math.max(RECENT_SCAN_CHAR_LIMIT, targetLines * 180)
  );
  const picked: string[] = [];
  let scannedChars = 0;
  let scannedLines = 0;

  for (let i = outputs.length - 1; i >= 0; i -= 1) {
    const data = outputs[i].data;
    picked.push(data);
    scannedChars += data.length;
    scannedLines += countNewlines(data);

    if (
      picked.length >= RECENT_SCAN_MIN_CHUNKS &&
      (scannedChars >= dynamicCharLimit || scannedLines >= targetLines)
    ) {
      break;
    }
  }

  picked.reverse();
  const cleaned = sanitizeTerminalText(picked.join(""));
  const allLines = cleaned
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  const maxOffset = Math.max(0, allLines.length - safeVisibleLines);
  const effectiveOffset = Math.min(safeScrollOffset, maxOffset);
  const start = Math.max(0, allLines.length - safeVisibleLines - effectiveOffset);
  const lines = allLines.slice(start, start + safeVisibleLines);

  return {
    lines,
    totalLines: allLines.length,
    maxOffset,
    effectiveOffset,
  };
}
