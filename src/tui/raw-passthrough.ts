import type { ProcessManager } from "../core/process-manager.js";

/**
 * Raw terminal passthrough mode.
 *
 * Connects stdin/stdout directly to the agent's PTY,
 * preserving the agent's native terminal UI (colors, box-drawing, cursor, etc.)
 *
 * Exit: Ctrl+] (GS, 0x1D) — returns to AgentMux TUI.
 */
export async function rawPassthrough(
  pm: ProcessManager,
  sessionId: string
): Promise<"detach" | "exited"> {
  const agentProcess = pm.get(sessionId);
  if (!agentProcess) return "exited";

  const session = pm.getSession(sessionId);
  const agentName = session?.agentName ?? "agent";

  // Clear screen and show hint bar
  process.stdout.write("\x1b[2J\x1b[H"); // clear screen, cursor home
  process.stdout.write(
    `\x1b[48;5;236m\x1b[37m AgentMux \x1b[1m| ${agentName} \x1b[22m| Ctrl+] to detach \x1b[0m\r\n`
  );

  // Resize PTY to match terminal
  const cols = process.stdout.columns || 120;
  const rows = (process.stdout.rows || 40) - 1; // -1 for the hint bar
  agentProcess.resize(cols, rows);

  // Replay entire buffer so user sees full agent UI
  for (const chunk of agentProcess.buffer) {
    process.stdout.write(chunk.data);
  }

  // Enter raw mode
  const wasRaw = process.stdin.isRaw;
  if (process.stdin.setRawMode) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();

  return new Promise<"detach" | "exited">((resolve) => {
    let resolved = false;

    const cleanup = () => {
      if (resolved) return;
      resolved = true;

      // Remove listeners
      process.stdin.off("data", onStdinData);
      unsubPty();

      // Restore raw mode
      if (process.stdin.setRawMode) {
        process.stdin.setRawMode(wasRaw ?? false);
      }

      // Clear screen before returning to Ink
      process.stdout.write("\x1b[2J\x1b[H");
    };

    // Forward stdin → PTY
    const onStdinData = (data: Buffer) => {
      const str = data.toString();

      // Ctrl+] (GS, 0x1D) — detach from agent
      if (str === "\x1d") {
        cleanup();
        resolve("detach");
        return;
      }

      // Forward to agent
      agentProcess.send(str);
    };

    // Forward PTY output → stdout
    const unsubPty = agentProcess.onData((data: string) => {
      process.stdout.write(data);
    });

    // Handle agent exit
    agentProcess.done.then(() => {
      cleanup();
      resolve("exited");
    });

    // Handle terminal resize
    const onResize = () => {
      const newCols = process.stdout.columns || 120;
      const newRows = (process.stdout.rows || 40) - 1;
      agentProcess.resize(newCols, newRows);
    };
    process.stdout.on("resize", onResize);

    process.stdin.on("data", onStdinData);
  });
}
