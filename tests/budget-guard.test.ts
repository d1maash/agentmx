import { describe, it, expect, vi } from "vitest";
import type {
  AgentOutput,
  AgentProcess,
  ClaudeActivity,
} from "../src/adapters/types.js";
import { attachBudgetGuard, readCurrentCost } from "../src/core/budget-guard.js";

/**
 * A minimal AgentProcess fake whose buffer we can mutate over time so the
 * guard's polling loop has something to read.
 */
function makeProc(): {
  proc: AgentProcess;
  pushCost: (cost: number) => void;
  resolveDone: (exit: number) => void;
  killSpy: ReturnType<typeof vi.fn>;
} {
  const buffer: AgentOutput[] = [];
  const killSpy = vi.fn(async () => undefined);
  let resolver!: (v: { exitCode: number }) => void;
  const done = new Promise<{ exitCode: number }>((r) => (resolver = r));

  const proc: AgentProcess = {
    send: () => undefined,
    output: { async *[Symbol.asyncIterator]() {} },
    status: "running",
    buffer,
    kill: killSpy,
    done,
    task: "fake",
    agentName: "fake",
    onData: () => () => undefined,
    resize: () => undefined,
  };

  const pushCost = (cost: number) => {
    const activity: ClaudeActivity = { kind: "cost", totalCost: cost, durationMs: 0 };
    buffer.push({ type: "system", data: "", timestamp: Date.now(), activity });
  };
  const resolveDone = (exit: number) => resolver({ exitCode: exit });

  return { proc, pushCost, resolveDone, killSpy };
}

describe("budget-guard", () => {
  it("readCurrentCost returns the highest reported total", () => {
    const { proc, pushCost } = makeProc();
    pushCost(0.01);
    pushCost(0.07);
    pushCost(0.05); // cumulative cost can only grow, but readCurrentCost is max-safe anyway
    expect(readCurrentCost(proc)).toBeCloseTo(0.07, 5);
  });

  it("does not poll when cap is zero or unset", async () => {
    const { proc, killSpy } = makeProc();
    const h = attachBudgetGuard(proc, { maxCostUsd: 0 });
    expect(h.breached).toBe(false);
    expect(killSpy).not.toHaveBeenCalled();
  });

  it("kills the process and fires onBreach when cost crosses the cap", async () => {
    const { proc, pushCost, killSpy, resolveDone } = makeProc();
    const onBreach = vi.fn();
    const h = attachBudgetGuard(proc, { maxCostUsd: 0.10, pollMs: 5, onBreach });

    pushCost(0.05);
    await new Promise((r) => setTimeout(r, 20));
    expect(h.breached).toBe(false); // under cap

    pushCost(0.12);
    await new Promise((r) => setTimeout(r, 30));

    expect(h.breached).toBe(true);
    expect(killSpy).toHaveBeenCalledTimes(1);
    expect(onBreach).toHaveBeenCalledWith(0.12, 0.10);

    resolveDone(143);
    h.stop();
  });

  it("never double-fires kill if cost keeps reporting after breach", async () => {
    const { proc, pushCost, killSpy, resolveDone } = makeProc();
    const h = attachBudgetGuard(proc, { maxCostUsd: 0.05, pollMs: 5 });
    pushCost(0.10);
    await new Promise((r) => setTimeout(r, 25));
    pushCost(0.20);
    await new Promise((r) => setTimeout(r, 25));
    expect(killSpy).toHaveBeenCalledTimes(1);
    resolveDone(143);
    h.stop();
  });

  it("stops polling once proc.done resolves", async () => {
    const { proc, pushCost, killSpy, resolveDone } = makeProc();
    const h = attachBudgetGuard(proc, { maxCostUsd: 1.00, pollMs: 5 });
    resolveDone(0);
    await new Promise((r) => setTimeout(r, 20));
    pushCost(5); // way over, but guard should be detached
    await new Promise((r) => setTimeout(r, 25));
    expect(killSpy).not.toHaveBeenCalled();
    h.stop();
  });
});
