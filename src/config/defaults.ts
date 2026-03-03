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
    aider: {
      command: "aider",
      args: [],
      env: {},
      enabled: false,
    },
    gemini: {
      command: "gemini",
      args: [],
      env: {},
      enabled: false,
    },
    copilot: {
      command: "copilot",
      args: [],
      env: {},
      enabled: false,
    },
    cursor: {
      command: "cursor-agent",
      args: [],
      env: {},
      enabled: false,
    },
    goose: {
      command: "goose",
      args: [],
      env: {},
      enabled: false,
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
