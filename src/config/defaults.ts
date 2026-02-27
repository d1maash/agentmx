import type { Config } from "./schema.js";

export const DEFAULT_CONFIG: Config = {
  default_agent: "claude-code",
  agents: {
    "claude-code": {
      command: "claude",
      args: [],
      env: {},
      enabled: true,
    },
    codex: {
      command: "codex",
      args: [],
      env: {},
      enabled: true,
    },
  },
  router: {
    mode: "manual",
    rules: [],
  },
  ui: {
    theme: "dark",
    show_tokens: false,
    show_cost: false,
    split_view: "vertical",
  },
};
