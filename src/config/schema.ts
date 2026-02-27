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
});

export type Config = z.infer<typeof ConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
