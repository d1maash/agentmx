export type AgentStatus = "idle" | "spawning" | "running" | "error" | "done";

export interface AgentOutput {
  type: "stdout" | "stderr" | "system";
  data: string;
  timestamp: number;
}

export interface AgentInfo {
  name: string;
  displayName: string;
  description: string;
  command: string;
  isInstalled: boolean;
}

export interface AgentProcess {
  /** Send text to agent's stdin */
  send(input: string): void;

  /** Agent output stream */
  output: AsyncIterable<AgentOutput>;

  /** Current status */
  status: AgentStatus;

  /** All accumulated output */
  buffer: AgentOutput[];

  /** Kill the process */
  kill(): Promise<void>;

  /** Promise that resolves when agent exits */
  done: Promise<{ exitCode: number }>;

  /** Task description */
  task: string;

  /** Agent name */
  agentName: string;

  /** Subscribe to raw output data. Returns unsubscribe function. */
  onData(listener: (data: string) => void): () => void;

  /** Resize the PTY */
  resize(cols: number, rows: number): void;
}

export interface AgentAdapter {
  readonly info: AgentInfo;

  /** Check if agent is installed on the system */
  checkInstalled(): Promise<boolean>;

  /** Spawn agent with a task */
  spawn(task: string, options?: SpawnOptions): AgentProcess;
}

export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  args?: string[];
}
