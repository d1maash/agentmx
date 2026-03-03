import { execSync } from "node:child_process";

export interface KnownAgent {
  name: string;
  displayName: string;
  command: string;
  description: string;
  defaultArgs: string[];
  installed: boolean;
}

const KNOWN_AGENTS: Omit<KnownAgent, "installed">[] = [
  {
    name: "claude-code",
    displayName: "Claude Code",
    command: "claude",
    description: "Anthropic's AI coding agent",
    defaultArgs: [],
  },
  {
    name: "codex",
    displayName: "Codex CLI",
    command: "codex",
    description: "OpenAI Codex CLI agent",
    defaultArgs: [],
  },
  {
    name: "aider",
    displayName: "Aider",
    command: "aider",
    description: "Git-integrated AI coding assistant",
    defaultArgs: [],
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

/**
 * Detect which known agents are installed on the system.
 * Checks PATH for claude, codex, aider binaries.
 */
export function detectAgents(): KnownAgent[] {
  return KNOWN_AGENTS.map((agent) => ({
    ...agent,
    installed: isCommandAvailable(agent.command),
  }));
}
