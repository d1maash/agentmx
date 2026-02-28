const ANSI_CSI_RE = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const ANSI_OSC_RE = /\x1B\][^\x07]*(?:\x07|\x1B\\)/g;
const ANSI_ESC_RE = /\x1B[@-Z\\-_]/g;
const CONTROL_RE = /[\x00-\x08\x0b-\x1f\x7f]/g;

export function sanitizeTerminalText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(ANSI_OSC_RE, "")
    .replace(ANSI_CSI_RE, "")
    .replace(ANSI_ESC_RE, "")
    .replace(CONTROL_RE, "");
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
