import type { ProcessManager } from "../core/process-manager.js";
import type { AgentAdapter, AgentProcess } from "../adapters/types.js";

/**
 * Terminal reset sequence — clears all modes Ink or other TUI frameworks
 * may have left active (mouse tracking, scroll regions, charsets, etc.)
 */
const TERMINAL_RESET =
  "\x1b[?1049l" + // Ensure main screen buffer (not alternate)
  "\x1b[?25h" + // Show cursor
  "\x1b[?1000l" + // Disable mouse click tracking
  "\x1b[?1002l" + // Disable mouse button-event tracking
  "\x1b[?1003l" + // Disable mouse any-event tracking
  "\x1b[?1006l" + // Disable SGR extended mouse mode
  "\x1b[r" + // Reset scroll region to full screen
  "\x1b(B" + // Reset charset to ASCII
  "\x1b[m" + // Reset all text attributes
  "\x1b[2J\x1b[H"; // Clear screen, cursor home

/**
 * Raw passthrough for an EXISTING running session.
 *
 * Replays any buffered output (that was produced while the TUI was showing),
 * then connects stdin/stdout directly to the agent's PTY.
 *
 * Exit: Ctrl+] (GS, 0x1D) — returns to AgentMux TUI.
 */
export async function rawPassthrough(
  pm: ProcessManager,
  sessionId: string
): Promise<"detach" | "exited"> {
  const agentProcess = pm.get(sessionId);
  if (!agentProcess) return "exited";

  if (agentProcess.status === "done" || agentProcess.status === "error") {
    return "exited";
  }

  // Clean terminal for the agent
  process.stdout.write(TERMINAL_RESET);

  if (process.stdin.setRawMode) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  return runPassthroughLoop(agentProcess, true);
}

/**
 * Spawn a NEW agent and immediately enter raw passthrough.
 *
 * The agent is spawned AFTER the output listener is ready,
 * so we never miss any output — no garbled/broken rendering.
 *
 * Exit: Ctrl+] (GS, 0x1D) — returns to AgentMux TUI.
 */
export async function rawPassthroughFresh(
  pm: ProcessManager,
  adapter: AgentAdapter,
  task: string
): Promise<{ result: "detach" | "exited"; sessionId: string }> {
  // Clean terminal BEFORE spawning the agent
  process.stdout.write(TERMINAL_RESET);

  if (process.stdin.setRawMode) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  // Spawn the agent — PTY starts producing output immediately
  const sessionId = await pm.start(adapter, task);
  const agentProcess = pm.get(sessionId)!;

  // Enter passthrough with buffer replay (catches any output from spawn)
  const result = await runPassthroughLoop(agentProcess, true);
  return { result, sessionId };
}

/**
 * Core passthrough loop shared by both rawPassthrough and rawPassthroughFresh.
 *
 * Connects stdin/stdout to the agent's PTY. All keystrokes go to the agent
 * except Ctrl+] which detaches.
 */
function runPassthroughLoop(
  agentProcess: AgentProcess,
  replayBuffer: boolean
): Promise<"detach" | "exited"> {
  return new Promise<"detach" | "exited">((resolve) => {
    let resolved = false;
    let resizeListener: (() => void) | null = null;

    const cleanup = () => {
      if (resolved) return;
      resolved = true;

      process.stdin.removeListener("data", onStdinData);
      if (unsubPty) unsubPty();

      if (resizeListener) {
        process.stdout.removeListener("resize", resizeListener);
      }

      if (process.stdin.setRawMode) {
        process.stdin.setRawMode(false);
      }

      // Clear screen before returning to Ink TUI
      process.stdout.write("\x1b[2J\x1b[H");
    };

    // Forward ALL stdin → PTY
    const onStdinData = (data: string | Buffer) => {
      const str = typeof data === "string" ? data : data.toString("utf8");

      // Only intercept Ctrl+] (GS, 0x1D) for detach
      if (str === "\x1d") {
        cleanup();
        resolve("detach");
        return;
      }

      // Everything else goes to the agent's PTY
      agentProcess.send(str);
    };

    // STEP 1: Subscribe to NEW PTY output first
    const unsubPty = agentProcess.onData((data: string) => {
      process.stdout.write(data);
    });

    // STEP 2: Replay buffered output that was produced before subscription.
    // This is synchronous — no events can fire between subscription and replay,
    // so there's no gap or duplication.
    if (replayBuffer && agentProcess.buffer.length > 0) {
      for (const output of agentProcess.buffer) {
        process.stdout.write(output.data);
      }
    }

    // Agent exited on its own
    const onDone = () => {
      if (!resolved) {
        cleanup();
        resolve("exited");
      }
    };
    agentProcess.done.then(onDone);

    // Forward terminal resize → PTY
    resizeListener = () => {
      const c = process.stdout.columns || 120;
      const r = process.stdout.rows || 40;
      agentProcess.resize(c, r);
    };
    process.stdout.on("resize", resizeListener);

    // Start listening to stdin
    process.stdin.on("data", onStdinData);

    // STEP 3: Force resize to ensure PTY matches actual terminal.
    // Use cols-1 first to guarantee SIGWINCH even if dimensions match.
    const cols = process.stdout.columns || 120;
    const rows = process.stdout.rows || 40;
    agentProcess.resize(cols - 1, rows);
    setTimeout(() => {
      if (!resolved) {
        agentProcess.resize(cols, rows);
      }
    }, 50);
  });
}
