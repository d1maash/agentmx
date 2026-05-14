import { z } from "zod";

export const AgentConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),
  enabled: z.boolean().default(true),
});

export const RouterRuleSchema = z.object({
  match: z.string(),
  agent: z.string(),
  reason: z.string().optional(),
});

export const ConfigSchema = z.object({
  default_agent: z.string().default("claude-code"),
  agents: z
    .record(AgentConfigSchema)
    .default({
      "claude-code": { command: "claude", args: [], env: {}, enabled: true },
      codex: { command: "codex", args: [], env: {}, enabled: true },
      aider: { command: "aider", args: [], env: {}, enabled: false },
      gemini: { command: "gemini", args: [], env: {}, enabled: false },
      copilot: { command: "copilot", args: [], env: {}, enabled: false },
      cursor: { command: "cursor-agent", args: [], env: {}, enabled: false },
      goose: { command: "goose", args: [], env: {}, enabled: false },
    }),
  router: z
    .object({
      mode: z.enum(["auto", "rules", "manual"]).default("manual"),
      rules: z.array(RouterRuleSchema).default([]),
    })
    .default({}),
  ui: z
    .object({
      theme: z.enum(["dark", "light"]).default("dark"),
      show_tokens: z.boolean().default(false),
      show_cost: z.boolean().default(false),
      split_view: z.enum(["vertical", "horizontal"]).default("vertical"),
    })
    .default({}),
  /**
   * Parallel-run safety. When isolate=true, vote/optimize/run -p each get
   * their own git worktree instead of racing for the same checkout.
   */
  parallel: z
    .object({
      isolate: z.boolean().default(false),
      keep_worktrees: z.boolean().default(false),
    })
    .default({}),
  /**
   * Hard-stop limits. Unlike the post-hoc alerts in `costs`, these kill the
   * process the moment the cap is reached.
   */
  budgets: z
    .object({
      /** USD cap per agent run. Overridable on the CLI via --max-cost. */
      hard_stop_per_run: z.number().positive().optional(),
    })
    .default({}),
});

export type Config = z.infer<typeof ConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
