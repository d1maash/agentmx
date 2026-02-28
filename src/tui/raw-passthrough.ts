import type { ProcessManager } from "../core/process-manager.js";
import type { AgentAdapter, AgentProcess } from "../adapters/types.js";

/**
 * Keep passthrough terminal prep minimal and predictable.
 * We intentionally avoid forcing alternate-screen toggles here,
 * because full-screen CLIs manage those themselves.
 */
const TERMINAL_PREP =
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
 * Connects stdin/stdout directly to the agent's PTY and requests
 * an explicit repaint from full-screen TUIs (Ctrl+L).
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

  process.stdout.write(TERMINAL_PREP);

  if (process.stdin.setRawMode) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  // Don't replay historical buffer for existing sessions:
  // full-screen TUIs (Claude Code, etc.) can render stale control
  // sequences from old frames, which causes visual artifacts.
  return runPassthroughLoop(agentProcess, { requestRepaint: true });
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
  process.stdout.write(TERMINAL_PREP);

  if (process.stdin.setRawMode) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  // Spawn the agent — PTY starts producing output immediately
  const sessionId = await pm.start(adapter, task);
  const agentProcess = pm.get(sessionId)!;

  // No buffer replay: it can duplicate control frames for full-screen TUIs.
  const result = await runPassthroughLoop(agentProcess, { requestRepaint: false });
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
  opts: { requestRepaint: boolean }
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

      // Prepare clean state before Ink remounts.
      process.stdout.write(TERMINAL_PREP);
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

    // Ensure PTY matches the current terminal dimensions.
    const cols = process.stdout.columns || 120;
    const rows = process.stdout.rows || 40;
    agentProcess.resize(cols, rows);

    // Existing full-screen sessions may need an explicit repaint.
    if (opts.requestRepaint) {
      setTimeout(() => {
        if (!resolved) {
          // Ctrl+L — widely supported redraw shortcut for TUIs.
          agentProcess.send("\x0c");
        }
      }, 40);
    }
  });
}
