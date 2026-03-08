import { EventEmitter } from "node:events";
import type { AgentOutput } from "../adapters/types.js";
import type { ProcessManager } from "./process-manager.js";

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

  constructor(
    private processManager: ProcessManager,
    options?: { maxHistory?: number }
  ) {
    super();
    this.maxHistory = options?.maxHistory ?? 1000;
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

      // Broadcast to all other connected sessions
      this.broadcast(message);
    });

    const subscription: ContextSubscription = {
      sessionId,
      agentName,
      unsubscribe,
    };

    this.subscriptions.set(sessionId, subscription);
    this.unsubscribers.set(sessionId, unsubscribe);

    this.emit("connected", { sessionId, agentName });
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
    for (const [sessionId, sub] of this.subscriptions) {
      if (sessionId === message.sourceSessionId) continue;

      const proc = this.processManager.get(sessionId);
      if (!proc) continue;

      // Format as context and send to the agent
      const contextPrefix = `[context from ${message.sourceAgent}] `;
      const text = message.output.data;

      // Only forward meaningful text (skip empty/whitespace)
      if (text.trim().length === 0) return;

      // Don't forward if it's too much data at once (> 2KB)
      // to avoid flooding agents
      if (text.length > 2048) {
        const truncated = text.slice(0, 2048) + "\n... (truncated)";
        proc.send(`${contextPrefix}${truncated}\n`);
      } else {
        proc.send(`${contextPrefix}${text}\n`);
      }
    }

    this.emit("broadcast", message);
  }

  /**
   * Send a summary of accumulated context to a specific session.
   */
  sendContextSummary(sessionId: string, fromAgent?: string): void {
    const proc = this.processManager.get(sessionId);
    if (!proc) return;

    const relevantHistory = fromAgent
      ? this.history.filter((m) => m.sourceAgent === fromAgent)
      : this.history;

    if (relevantHistory.length === 0) return;

    // Build summary (last N messages, max 4KB)
    const lines: string[] = [];
    let totalSize = 0;
    const maxSize = 4096;

    for (let i = relevantHistory.length - 1; i >= 0; i--) {
      const msg = relevantHistory[i];
      const line = `[${msg.sourceAgent}] ${msg.output.data.trim()}`;
      if (totalSize + line.length > maxSize) break;
      lines.unshift(line);
      totalSize += line.length;
    }

    const summary = `\n--- Shared Context Summary ---\n${lines.join("\n")}\n--- End Context ---\n`;
    proc.send(summary);
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

  /** Clear the history */
  clearHistory(): void {
    this.history = [];
  }

  /** Get number of connected sessions */
  get size(): number {
    return this.subscriptions.size;
  }
}
