import { execFile } from "node:child_process";

/**
 * Send a macOS system notification when a long-running task completes.
 * Falls back silently on non-macOS platforms.
 */
export function sendNotification(title: string, message: string): void {
  if (process.platform !== "darwin") return;

  const script = `display notification "${escapeAppleScript(message)}" with title "${escapeAppleScript(title)}" sound name "Glass"`;

  execFile("osascript", ["-e", script], (err) => {
    // Silently ignore errors (e.g. no notification permission)
    if (err) {
      // noop
    }
  });
}

function escapeAppleScript(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
