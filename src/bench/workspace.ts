import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import type { BenchProblem } from "./types.js";

export interface Workspace {
  dir: string;
  problemId: string;
  agentName: string;
}

/**
 * Creates an isolated temp directory for an (agent, problem) pair,
 * writes scaffold files, and runs npm install.
 */
export async function createWorkspace(
  problem: BenchProblem,
  agentName: string
): Promise<Workspace> {
  const base = join(tmpdir(), "amx-bench");
  mkdirSync(base, { recursive: true });

  const dir = join(base, `${problem.id}-${agentName}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });

  // Write scaffold files
  for (const [relativePath, content] of Object.entries(problem.scaffoldFiles)) {
    const fullPath = join(dir, relativePath);
    const parentDir = fullPath.substring(0, fullPath.lastIndexOf("/"));
    mkdirSync(parentDir, { recursive: true });
    writeFileSync(fullPath, content, "utf-8");
  }

  // Create src directory so agents have a place to write
  mkdirSync(join(dir, "src"), { recursive: true });

  // Run npm install
  try {
    execSync("npm install --silent", {
      cwd: dir,
      timeout: 60_000,
      stdio: "pipe",
    });
  } catch {
    // Non-fatal — some problems may not need dependencies
  }

  return { dir, problemId: problem.id, agentName };
}

/**
 * Removes a workspace directory.
 */
export function removeWorkspace(workspace: Workspace): void {
  try {
    rmSync(workspace.dir, { recursive: true, force: true });
  } catch {
    // Best effort cleanup
  }
}
