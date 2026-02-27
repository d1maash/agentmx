import { cosmiconfig } from "cosmiconfig";
import { ConfigSchema, type Config } from "./schema.js";

export async function loadConfig(): Promise<Config> {
  const explorer = cosmiconfig("agentmux");
  try {
    const result = await explorer.search();
    const raw = result?.config ?? {};
    return ConfigSchema.parse(raw);
  } catch {
    return ConfigSchema.parse({});
  }
}
