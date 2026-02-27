import type { AgentAdapter, AgentOutput } from "../adapters/types.js";
import type { ProcessManager } from "./process-manager.js";

export interface PipelineStep {
  agent: string;
  task: string;
}

export interface PipelineOutput {
  step: number;
  agent: string;
  output: AgentOutput;
}

export function parsePipelineSteps(steps: string[]): PipelineStep[] {
  return steps.map((step) => {
    const colonIndex = step.indexOf(":");
    if (colonIndex === -1) {
      throw new Error(
        `Invalid pipeline step: "${step}". Expected format: "agent: task"`
      );
    }
    return {
      agent: step.slice(0, colonIndex).trim(),
      task: step.slice(colonIndex + 1).trim(),
    };
  });
}

export class Pipeline {
  constructor(
    private steps: PipelineStep[],
    private processManager: ProcessManager,
    private adapters: Map<string, AgentAdapter>
  ) {}

  async *execute(): AsyncGenerator<PipelineOutput> {
    let previousOutput = "";

    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i];
      const adapter = this.adapters.get(step.agent);

      if (!adapter) {
        throw new Error(`Agent "${step.agent}" not found`);
      }

      // Combine task with previous agent's output
      const fullTask = previousOutput
        ? `${step.task}\n\nContext from previous agent:\n${previousOutput}`
        : step.task;

      const sessionId = await this.processManager.start(adapter, fullTask);
      const agentProcess = this.processManager.get(sessionId);

      if (!agentProcess) {
        throw new Error(`Failed to get process for session ${sessionId}`);
      }

      let stepOutput = "";
      for await (const chunk of agentProcess.output) {
        stepOutput += chunk.data;
        yield { step: i, agent: step.agent, output: chunk };
      }

      previousOutput = stepOutput;
    }
  }
}
