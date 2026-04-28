import { EventEmitter } from "node:events";
import type { AgentOutput } from "../adapters/types.js";
import type { ProcessManager } from "./process-manager.js";
import {
  createSharedContextState,
  formatSharedContextState,
  updateSharedContextState,
  type SharedContextState,
} from "./context-state.js";

export interface ContextMessage {
  /** Source session ID */
  sourceSessionId: string;
  /** Source agent name */
  sourceAgent: string;
  /** The output data */
  output: AgentOutput;
  /** Timestamp when published */
  timestamp: number;
}

export interface ContextSubscription {
  sessionId: string;
  agentName: string;
  unsubscribe: () => void;
}

/**
 * ContextBus enables real-time context sharing between running agents.
 *
 * When agents are connected to the bus, output from one agent is
 * broadcast to all other connected agents as context input.
 */
export class ContextBus extends EventEmitter {
  private subscriptions = new Map<string, ContextSubscription>();
  private history: ContextMessage[] = [];
  private unsubscribers = new Map<string, () => void>();
  private maxHistory: number;
  private paused = false;
  private sharedState: SharedContextState;

  constructor(
    private processManager: ProcessManager,
    options?: { cwd?: string; maxHistory?: number; task?: string }
  ) {
    super();
    this.maxHistory = options?.maxHistory ?? 1000;
    this.sharedState = createSharedContextState({
      cwd: options?.cwd,
      task: options?.task,
    });
  }

  /**
   * Connect a session to the context bus.
   * Its output will be broadcast to all other connected sessions.
   */
  connect(sessionId: string, agentName: string): ContextSubscription {
    const proc = this.processManager.get(sessionId);
    if (!proc) {
      throw new Error(`Session "${sessionId}" not found`);
    }

    // Subscribe to raw output data from this agent
    const unsubscribe = proc.onData((data: string) => {
      if (this.paused) return;

      const message: ContextMessage = {
        sourceSessionId: sessionId,
        sourceAgent: agentName,
        output: {
          type: "stdout",
          data,
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
      };

      // Store in history
      this.history.push(message);
      if (this.history.length > this.maxHistory) {
        this.history = this.history.slice(-this.maxHistory);
      }

      const changed = updateSharedContextState(this.sharedState, {
        sourceSessionId: sessionId,
        sourceAgent: agentName,
        text: data,
        timestamp: message.timestamp,
      });

      // Broadcast the structured state to all other connected sessions.
      if (changed) {
        this.broadcast(message);
      }
    });

    const subscription: ContextSubscription = {
      sessionId,
      agentName,
      unsubscribe,
    };

    this.subscriptions.set(sessionId, subscription);
    this.unsubscribers.set(sessionId, unsubscribe);

    this.emit("connected", { sessionId, agentName });
    proc.send(formatSharedContextState(this.sharedState));
    return subscription;
  }

  /**
   * Disconnect a session from the context bus.
   */
  disconnect(sessionId: string): void {
    const unsub = this.unsubscribers.get(sessionId);
    if (unsub) {
      unsub();
      this.unsubscribers.delete(sessionId);
    }
    this.subscriptions.delete(sessionId);
    this.emit("disconnected", { sessionId });
  }

  /**
   * Disconnect all sessions.
   */
  disconnectAll(): void {
    for (const sessionId of Array.from(this.subscriptions.keys())) {
      this.disconnect(sessionId);
    }
  }

  /**
   * Broadcast a context message to all connected sessions
   * except the source.
   */
  private broadcast(message: ContextMessage): void {
    for (const sessionId of this.subscriptions.keys()) {
      if (sessionId === message.sourceSessionId) continue;

      const proc = this.processManager.get(sessionId);
      if (!proc) continue;

      proc.send(formatSharedContextState(this.sharedState));
    }

    this.emit("broadcast", message);
  }

  /**
   * Send a summary of accumulated context to a specific session.
   */
  sendContextSummary(sessionId: string): void {
    const proc = this.processManager.get(sessionId);
    if (!proc) return;

    proc.send(formatSharedContextState(this.sharedState));
  }

  /** Pause broadcasting (temporarily mute) */
  pause(): void {
    this.paused = true;
    this.emit("paused");
  }

  /** Resume broadcasting */
  resume(): void {
    this.paused = false;
    this.emit("resumed");
  }

  /** Check if broadcasting is paused */
  get isPaused(): boolean {
    return this.paused;
  }

  /** Get all connected session IDs */
  get connectedSessions(): string[] {
    return Array.from(this.subscriptions.keys());
  }

  /** Get the full message history */
  getHistory(limit?: number): ContextMessage[] {
    if (limit) {
      return this.history.slice(-limit);
    }
    return [...this.history];
  }

  /** Get the current structured shared state */
  getState(): SharedContextState {
    return structuredClone(this.sharedState);
  }

  /** Clear the history */
  clearHistory(): void {
    this.history = [];
  }

  /** Get number of connected sessions */
  get size(): number {
    return this.subscriptions.size;
  }
}
