import { execSync } from "node:child_process";

export interface KnownAgent {
  name: string;
  displayName: string;
  command: string;
  description: string;
  defaultArgs: string[];
  installUrl: string;
  installed: boolean;
  version: string | null;
}

const KNOWN_AGENTS: Omit<KnownAgent, "installed" | "version">[] = [
  {
    name: "claude-code",
    displayName: "Claude Code",
    command: "claude",
    description: "Anthropic's AI coding agent",
    defaultArgs: [],
    installUrl: "https://docs.anthropic.com/en/docs/claude-code",
  },
  {
    name: "codex",
    displayName: "Codex CLI",
    command: "codex",
    description: "OpenAI Codex CLI agent",
    defaultArgs: [],
    installUrl: "https://github.com/openai/codex",
  },
  {
    name: "aider",
    displayName: "Aider",
    command: "aider",
    description: "Git-integrated AI coding assistant",
    defaultArgs: [],
    installUrl: "https://aider.chat/docs/install.html",
  },
  {
    name: "gemini",
    displayName: "Gemini CLI",
    command: "gemini",
    description: "Google Gemini CLI agent",
    defaultArgs: [],
    installUrl: "https://github.com/google-gemini/gemini-cli",
  },
  {
    name: "copilot",
    displayName: "GitHub Copilot",
    command: "gh",
    description: "GitHub Copilot CLI extension",
    defaultArgs: [],
    installUrl: "https://github.com/github/gh-copilot",
  },
  {
    name: "cursor",
    displayName: "Cursor Agent",
    command: "cursor-agent",
    description: "Cursor AI coding agent",
    defaultArgs: [],
    installUrl: "https://docs.cursor.com",
  },
  {
    name: "goose",
    displayName: "Goose",
    command: "goose",
    description: "Open-source AI developer agent",
    defaultArgs: [],
    installUrl: "https://github.com/block/goose",
  },
];

function isCommandAvailable(command: string): boolean {
  try {
    execSync(`which ${command}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function getVersion(command: string): string | null {
  try {
    const output = execSync(`${command} --version 2>/dev/null || ${command} -v 2>/dev/null || ${command} version 2>/dev/null`, {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    });
    const raw = output.toString().trim();
    // Extract first version-like pattern
    const match = raw.match(/\d+\.\d+[\w.\-]*/);
    return match ? match[0] : raw.slice(0, 30);
  } catch {
    return null;
  }
}

/**
 * Detect which known agents are installed on the system.
 * Checks PATH for all 7 supported agent binaries and resolves versions.
 */
export function detectAgents(): KnownAgent[] {
  return KNOWN_AGENTS.map((agent) => {
    const installed = isCommandAvailable(agent.command);
    return {
      ...agent,
      installed,
      version: installed ? getVersion(agent.command) : null,
    };
  });
}
