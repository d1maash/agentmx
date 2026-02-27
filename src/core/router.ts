import type { Config } from "../config/schema.js";

export class Router {
  constructor(private config: Config) {}

  /** Determine which agent to use for a task */
  async route(task: string): Promise<string> {
    const mode = this.config.router.mode;

    if (mode === "manual") {
      return this.config.default_agent;
    }

    if (mode === "rules") {
      for (const rule of this.config.router.rules) {
        const regex = new RegExp(rule.match, "i");
        if (regex.test(task)) {
          return rule.agent;
        }
      }
      return this.config.default_agent;
    }

    if (mode === "auto") {
      // Future: call a lightweight LLM for task classification
      // For now, fallback to rules → default
      for (const rule of this.config.router.rules) {
        const regex = new RegExp(rule.match, "i");
        if (regex.test(task)) {
          return rule.agent;
        }
      }
      return this.config.default_agent;
    }

    return this.config.default_agent;
  }
}
