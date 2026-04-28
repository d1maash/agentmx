import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import {
  escalateUntilPass,
  raceUntilPass,
  type OptimizerTier,
} from "../src/core/optimizer.js";
import { ProcessManager } from "../src/core/process-manager.js";
import type {
  AgentAdapter,
  AgentInfo,
  AgentOutput,
  AgentProcess,
  ClaudeActivity,
} from "../src/adapters/types.js";

/**
 * A fake adapter we can fully script: when it spawns we choose its exit code,
 * how much "cost" it reports, and how long it takes. The optimizer treats
 * these adapters identically to real ones, so we can test the whole
 * escalation/race state machine without ever shelling out to a real CLI.
 */
function makeAdapter(name: string, opts: {
  exitCode: number;
  cost?: number;
  delayMs?: number;
}): AgentAdapter {
  const info: AgentInfo = {
    name,
    displayName: name,
    description: "fake",
    command: "echo",
    isInstalled: true,
  };
  return {
    info,
    async checkInstalled() {
      return true;
    },
    spawn(task: string): AgentProcess {
      const buffer: AgentOutput[] = [];
      const out: AgentOutput = {
        type: "stdout",
        data: `[${name}] running: ${task}\n`,
        timestamp: Date.now(),
      };
      buffer.push(out);

      if (opts.cost && opts.cost > 0) {
        const activity: ClaudeActivity = {
          kind: "cost",
          totalCost: opts.cost,
          durationMs: opts.delayMs ?? 0,
        };
        buffer.push({
          type: "system",
          data: "",
          timestamp: Date.now(),
          activity,
        });
      }

      const done = new Promise<{ exitCode: number }>((resolve) => {
        setTimeout(() => resolve({ exitCode: opts.exitCode }), opts.delayMs ?? 5);
      });

      // One-shot async iterable — yields the buffered chunks then ends.
      const output: AsyncIterable<AgentOutput> = {
        async *[Symbol.asyncIterator]() {
          for (const entry of buffer) yield entry;
        },
      };

      const proc: AgentProcess = {
        send: () => undefined,
        output,
        status: "running",
        buffer,
        kill: async () => undefined,
        done,
        task,
        agentName: name,
        onData: () => () => undefined,
        resize: () => undefined,
      };
      return proc;
    },
  };
}

let workDir: string;
let prevCwd: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "amx-optimizer-"));
  prevCwd = process.cwd();
  process.chdir(workDir);
  // Initialize a git repo with one tracked file so verifySolution() can diff.
  execSync("git init -q", { cwd: workDir });
  execSync("git config user.email t@t.t && git config user.name t", { cwd: workDir });
  writeFileSync(join(workDir, "README.md"), "# fixture\n");
  execSync("git add -A && git commit -q -m init", { cwd: workDir });
});

afterEach(() => {
  process.chdir(prevCwd);
  rmSync(workDir, { recursive: true, force: true });
});

describe("escalateUntilPass", () => {
  it("stops at the first tier that produces a passing patch", async () => {
    // Cheap tier exits 0 AND writes a real file change so verifySolution sees a diff.
    const cheap = makeAdapter("cheap", { exitCode: 0, cost: 0.05 });
    const expensive = makeAdapter("expensive", { exitCode: 0, cost: 0.50 });
    const adapters = new Map<string, AgentAdapter>([
      ["cheap", cheap],
      ["expensive", expensive],
    ]);
    const tiers: OptimizerTier[] = [
      { agent: "cheap", label: "cheap" },
      { agent: "expensive", label: "expensive" },
    ];

    // Stage a real change so the diff check passes.
    writeFileSync(join(workDir, "src.txt"), "added by cheap tier\n");

    const pm = new ProcessManager(workDir);
    const outcome = await escalateUntilPass("touch src.txt", tiers, pm, adapters, {
      cwd: workDir,
      verifyOverrides: { runTests: false, runLint: false, runTypecheck: false },
    });

    expect(outcome.success).toBe(true);
    expect(outcome.attempts).toHaveLength(1);
    expect(outcome.winner?.tier.agent).toBe("cheap");
    expect(outcome.totalCost).toBeCloseTo(0.05, 5);
  });

  it("escalates to expensive when cheap exits non-zero", async () => {
    const cheap = makeAdapter("cheap", { exitCode: 1, cost: 0.05 });
    const expensive = makeAdapter("expensive", { exitCode: 0, cost: 0.50 });
    const adapters = new Map<string, AgentAdapter>([
      ["cheap", cheap],
      ["expensive", expensive],
    ]);
    const tiers: OptimizerTier[] = [
      { agent: "cheap" },
      { agent: "expensive" },
    ];

    const pm = new ProcessManager(workDir);
    // skipVerify so success is determined purely by exit code: cheap fails (1),
    // optimizer escalates, expensive succeeds (0).
    const outcome = await escalateUntilPass("any task", tiers, pm, adapters, {
      cwd: workDir,
      skipVerify: true,
    });

    expect(outcome.success).toBe(true);
    expect(outcome.attempts).toHaveLength(2);
    expect(outcome.attempts[0].verdict).toBe("fail");
    expect(outcome.winner?.tier.agent).toBe("expensive");
    // Total cost includes the wasted cheap attempt — this is the
    // "cost of the successful PR" the user is paying for.
    expect(outcome.totalCost).toBeCloseTo(0.55, 5);
  });

  it("returns failure with cumulative cost when every tier fails", async () => {
    const cheap = makeAdapter("cheap", { exitCode: 1, cost: 0.05 });
    const expensive = makeAdapter("expensive", { exitCode: 1, cost: 0.50 });
    const adapters = new Map<string, AgentAdapter>([
      ["cheap", cheap],
      ["expensive", expensive],
    ]);
    const pm = new ProcessManager(workDir);
    const outcome = await escalateUntilPass(
      "broken",
      [{ agent: "cheap" }, { agent: "expensive" }],
      pm,
      adapters,
      { cwd: workDir, skipVerify: true }
    );

    expect(outcome.success).toBe(false);
    expect(outcome.winner).toBeUndefined();
    expect(outcome.totalCost).toBeCloseTo(0.55, 5);
  });

  it("skips verification when skipVerify is set", async () => {
    const cheap = makeAdapter("cheap", { exitCode: 0, cost: 0.05 });
    const adapters = new Map<string, AgentAdapter>([["cheap", cheap]]);
    const pm = new ProcessManager(workDir);
    const outcome = await escalateUntilPass(
      "anything",
      [{ agent: "cheap" }],
      pm,
      adapters,
      { cwd: workDir, skipVerify: true }
    );
    expect(outcome.success).toBe(true);
    expect(outcome.winner?.proof).toBeUndefined();
  });
});

describe("raceUntilPass", () => {
  it("the fastest passing agent wins; siblings are cancelled and counted", async () => {
    const fast = makeAdapter("fast", { exitCode: 0, cost: 0.20, delayMs: 5 });
    const slow = makeAdapter("slow", { exitCode: 0, cost: 0.10, delayMs: 200 });
    const adapters = new Map<string, AgentAdapter>([
      ["fast", fast],
      ["slow", slow],
    ]);

    writeFileSync(join(workDir, "src.txt"), "winner output\n");

    const pm = new ProcessManager(workDir);
    const outcome = await raceUntilPass(
      "race",
      [{ agent: "fast" }, { agent: "slow" }],
      pm,
      adapters,
      {
        cwd: workDir,
        verifyOverrides: { runTests: false, runLint: false, runTypecheck: false },
      }
    );

    expect(outcome.success).toBe(true);
    expect(outcome.winner?.tier.agent).toBe("fast");
    // Both attempts are recorded so the cost-of-PR is accurate.
    expect(outcome.attempts).toHaveLength(2);
    const slowAttempt = outcome.attempts.find((a) => a.tier.agent === "slow");
    expect(slowAttempt?.verdict).toBe("fail");
    expect(slowAttempt?.abortedReason).toMatch(/cancelled|sibling/);
  });
});

describe("cost extraction", () => {
  it("captures the maximum reported totalCost across activity events", async () => {
    const adapter = makeAdapter("cheap", { exitCode: 0, cost: 0.42 });
    const adapters = new Map<string, AgentAdapter>([["cheap", adapter]]);
    const pm = new ProcessManager(workDir);
    const outcome = await escalateUntilPass(
      "task",
      [{ agent: "cheap" }],
      pm,
      adapters,
      { cwd: workDir, skipVerify: true }
    );
    expect(outcome.attempts[0].cost).toBeCloseTo(0.42, 5);
  });
});

// Suppress noise from unused imports under tsc.
void vi;
