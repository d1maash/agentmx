import type { AgentProcess, ClaudeActivity } from "../adapters/types.js";

/** Read the highest cost reported so far in the agent's activity log. */
export function readCurrentCost(proc: AgentProcess): number {
  let cost = 0;
  for (const entry of proc.buffer) {
    if (entry.activity?.kind === "cost") {
      const act = entry.activity as Extract<ClaudeActivity, { kind: "cost" }>;
      if (act.totalCost > cost) cost = act.totalCost;
    }
  }
  return cost;
}

export interface BudgetGuardOptions {
  /** USD cap for the lifetime of this session. */
  maxCostUsd: number;
  /** Poll cadence in ms. Default 1000. */
  pollMs?: number;
  /** Called once when the cap is breached, before kill(). */
  onBreach?: (cost: number, cap: number) => void;
}

export interface BudgetGuardHandle {
  /** True once the guard observed an over-budget condition and triggered kill. */
  readonly breached: boolean;
  /** Most recent observed cost (for diagnostics). */
  readonly lastCost: number;
  /** Stop polling. Safe to call multiple times. */
  stop(): void;
}

/**
 * Attach a hard-stop cost cap to an already-spawned agent. Polls the agent's
 * cost activity events; when total spend reaches the cap, kills the process.
 *
 * The guard auto-detaches when proc.done resolves. Returns a handle so
 * callers can introspect whether the kill happened (-> exit code 2 mapping).
 */
export function attachBudgetGuard(
  proc: AgentProcess,
  opts: BudgetGuardOptions
): BudgetGuardHandle {
  const cap = opts.maxCostUsd;
  if (!(cap > 0)) {
    return { breached: false, lastCost: 0, stop: () => undefined };
  }
  const pollMs = opts.pollMs ?? 1000;

  const handle = {
    breached: false,
    lastCost: 0,
    stop: () => undefined as void,
  } as { breached: boolean; lastCost: number; stop: () => void };

  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    const cost = readCurrentCost(proc);
    handle.lastCost = cost;
    if (cost >= cap && !handle.breached) {
      handle.breached = true;
      stopCheck();
      try {
        opts.onBreach?.(cost, cap);
      } catch {
        // Listeners must never crash the guard.
      }
      void proc.kill();
    }
  }, pollMs);
  // Don't keep the event loop alive solely for this guard.
  if (typeof timer.unref === "function") timer.unref();

  const stopCheck = (): void => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
  };
  handle.stop = stopCheck;

  proc.done.finally(stopCheck);

  return handle;
}
