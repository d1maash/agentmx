import type { ProcessManager } from "../core/process-manager.js";

/**
 * Raw terminal passthrough mode.
 *
 * Directly connects stdin/stdout to the agent's PTY,
 * preserving the agent's native terminal UI perfectly.
 *
 * The agent controls the entire screen — AgentMux is invisible.
 * Exit: Ctrl+] (GS, 0x1D) — returns to AgentMux TUI.
 */
export async function rawPassthrough(
  pm: ProcessManager,
  sessionId: string
): Promise<"detach" | "exited"> {
  const agentProcess = pm.get(sessionId);
  if (!agentProcess) return "exited";

  // If agent already done, don't enter passthrough
  if (agentProcess.status === "done" || agentProcess.status === "error") {
    return "exited";
  }

  // Clear screen
  process.stdout.write("\x1b[2J\x1b[H");

  // Resize PTY to match full terminal
  const cols = process.stdout.columns || 120;
  const rows = process.stdout.rows || 40;
  agentProcess.resize(cols, rows);

  // Small delay then resize again to force agent redraw
  await new Promise((r) => setTimeout(r, 100));
  agentProcess.resize(cols, rows);

  // Set stdin to raw mode so ALL keystrokes pass through
  // (arrows, Enter, Escape, Ctrl+keys, etc.)
  if (process.stdin.setRawMode) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  // Remove any default encoding so we get raw buffers
  process.stdin.setEncoding("utf8");

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

      // Everything else goes to the agent's PTY — Enter, arrows,
      // Escape, number keys, Ctrl+C, etc.
      agentProcess.send(str);
    };

    // Forward PTY → stdout (completely raw, preserving all ANSI)
    const unsubPty = agentProcess.onData((data: string) => {
      process.stdout.write(data);
    });

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

    // Start listening
    process.stdin.on("data", onStdinData);
  });
}
