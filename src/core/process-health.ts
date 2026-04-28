import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const KIB = 1024;

export interface ProcessHealthSnapshot {
  cpuPercent: number;
  memoryBytes: number;
}

export function parsePsOutput(stdout: string): Map<number, ProcessHealthSnapshot> {
  const snapshots = new Map<number, ProcessHealthSnapshot>();

  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = line.match(/^(\d+)\s+([\d.]+)\s+(\d+)$/);
    if (!match) continue;

    const pid = Number.parseInt(match[1], 10);
    const cpuPercent = Number.parseFloat(match[2]);
    const rssKib = Number.parseInt(match[3], 10);

    if (!Number.isFinite(pid) || !Number.isFinite(cpuPercent) || !Number.isFinite(rssKib)) {
      continue;
    }

    snapshots.set(pid, {
      cpuPercent,
      memoryBytes: rssKib * KIB,
    });
  }

  return snapshots;
}

export async function getProcessHealth(pids: number[]): Promise<Map<number, ProcessHealthSnapshot>> {
  const uniquePids = Array.from(
    new Set(
      pids.filter((pid) => Number.isInteger(pid) && pid > 0)
    )
  );

  if (uniquePids.length === 0 || process.platform === "win32") {
    return new Map();
  }

  const args = [
    "-o", "pid=",
    "-o", "%cpu=",
    "-o", "rss=",
    ...uniquePids.flatMap((pid) => ["-p", String(pid)]),
  ];

  try {
    const { stdout } = await execFileAsync("ps", args);
    return parsePsOutput(stdout);
  } catch {
    return new Map();
  }
}
