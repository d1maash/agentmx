import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { stringify } from "yaml";
import { detectAgents, type KnownAgent } from "../../config/detect.js";

const CONFIG_FILE = ".agentmx.yml";

async function ask(
  rl: ReturnType<typeof createInterface>,
  question: string,
): Promise<string> {
  const answer = await rl.question(question);
  return answer.trim();
}

async function confirm(
  rl: ReturnType<typeof createInterface>,
  question: string,
  defaultYes = true,
): Promise<boolean> {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = await ask(rl, `${question} ${hint} `);
  if (answer === "") return defaultYes;
  return answer.toLowerCase().startsWith("y");
}

function printDetectionTable(agents: KnownAgent[]): void {
  const installed = agents.filter((a) => a.installed);
  const missing = agents.filter((a) => !a.installed);

  // Header
  const total = agents.length;
  const bar = "─".repeat(52);
  console.log(`  ${chalk.dim("┌")}${chalk.dim(bar)}${chalk.dim("┐")}`);
  console.log(
    `  ${chalk.dim("│")} ${chalk.bold("Agent Detection")}${" ".repeat(36)}${chalk.dim("│")}`,
  );
  console.log(
    `  ${chalk.dim("│")} ${chalk.dim(`${installed.length}/${total} agents found on this system`)}${" ".repeat(52 - 1 - `${installed.length}/${total} agents found on this system`.length)}${chalk.dim("│")}`,
  );
  console.log(`  ${chalk.dim("├")}${chalk.dim(bar)}${chalk.dim("┤")}`);

  // Installed agents
  for (const agent of installed) {
    const ver = agent.version ? chalk.dim(` v${agent.version}`) : "";
    const name = chalk.green.bold(agent.displayName);
    const cmd = chalk.dim(`(${agent.command})`);
    const check = chalk.green("●");
    const line = `${check} ${name} ${cmd}${ver}`;
    const visLen =
      agent.displayName.length +
      agent.command.length +
      3 + // " () "
      2 + // "● "
      (agent.version ? ` v${agent.version}`.length : 0);
    const pad = " ".repeat(Math.max(0, 51 - visLen));
    console.log(`  ${chalk.dim("│")} ${line}${pad}${chalk.dim("│")}`);
  }

  // Separator if both sections exist
  if (installed.length > 0 && missing.length > 0) {
    console.log(`  ${chalk.dim("├")}${chalk.dim(bar)}${chalk.dim("┤")}`);
  }

  // Missing agents
  for (const agent of missing) {
    const name = chalk.dim(agent.displayName);
    const cmd = chalk.dim(`(${agent.command})`);
    const cross = chalk.dim("○");
    const line = `${cross} ${name} ${cmd}`;
    const visLen =
      agent.displayName.length +
      agent.command.length +
      3 + // " () "
      2; // "○ "
    const pad = " ".repeat(Math.max(0, 51 - visLen));
    console.log(`  ${chalk.dim("│")} ${line}${pad}${chalk.dim("│")}`);
  }

  console.log(`  ${chalk.dim("└")}${chalk.dim(bar)}${chalk.dim("┘")}`);

  // Install hints for missing agents
  if (missing.length > 0) {
    console.log();
    console.log(`  ${chalk.dim("Install missing agents:")}`);
    for (const agent of missing) {
      console.log(
        `  ${chalk.dim("→")} ${chalk.white(agent.displayName)}: ${chalk.cyan.underline(agent.installUrl)}`,
      );
    }
  }
}

async function selectAgents(
  rl: ReturnType<typeof createInterface>,
  agents: KnownAgent[],
): Promise<KnownAgent[]> {
  const selected: KnownAgent[] = [];

  for (const agent of agents) {
    const icon = agent.installed ? chalk.green("●") : chalk.dim("○");
    const name = agent.installed
      ? chalk.bold(agent.displayName)
      : chalk.dim(agent.displayName);
    const cmd = chalk.dim(`(${agent.command})`);
    const status = agent.installed
      ? chalk.green("installed")
      : chalk.red("not found");

    const defaultEnable = agent.installed;
    const enabled = await confirm(
      rl,
      `  ${icon} ${name} ${cmd} — ${status}. Enable?`,
      defaultEnable,
    );

    if (enabled) {
      selected.push(agent);
    }
  }

  return selected;
}

function buildConfig(
  agents: KnownAgent[],
  defaultAgent: string,
  routerMode: string,
): Record<string, unknown> {
  const agentsConfig: Record<string, Record<string, unknown>> = {};

  for (const agent of agents) {
    const entry: Record<string, unknown> = {
      command: agent.command,
      enabled: true,
    };
    if (agent.defaultArgs.length > 0) {
      entry.args = agent.defaultArgs;
    }
    agentsConfig[agent.name] = entry;
  }

  return {
    default_agent: defaultAgent,
    agents: agentsConfig,
    router: {
      mode: routerMode,
    },
    ui: {
      theme: "dark",
      show_tokens: false,
      show_cost: false,
    },
  };
}

export async function initCommand(): Promise<void> {
  const configPath = join(process.cwd(), CONFIG_FILE);

  console.log();
  console.log(chalk.bold("  AgentMX Setup"));
  console.log(chalk.dim("  Configure your AI agents\n"));

  // Check for existing config
  if (existsSync(configPath)) {
    const rl = createInterface({ input: stdin, output: stdout });
    const overwrite = await confirm(
      rl,
      chalk.yellow(`  ${CONFIG_FILE} already exists. Overwrite?`),
      false,
    );
    if (!overwrite) {
      console.log(chalk.dim("\n  Aborted."));
      rl.close();
      return;
    }
    rl.close();
  }

  // Detect agents
  console.log(chalk.dim("  Scanning for installed agents...\n"));
  const agents = detectAgents();

  // Print detection table
  printDetectionTable(agents);
  console.log();

  // Interactive selection
  const rl = createInterface({ input: stdin, output: stdout });

  console.log(chalk.bold("  Select agents to enable:\n"));
  const selected = await selectAgents(rl, agents);

  if (selected.length === 0) {
    console.log(chalk.red("\n  No agents selected. Aborted."));
    rl.close();
    return;
  }

  // Choose default agent
  let defaultAgent = selected[0].name;
  if (selected.length > 1) {
    console.log(chalk.bold("\n  Choose default agent:\n"));
    selected.forEach((a, i) => {
      console.log(`    ${i + 1}) ${a.displayName}`);
    });

    const choice = await ask(rl, `\n  Default agent [1]: `);
    const idx = choice === "" ? 0 : parseInt(choice, 10) - 1;
    if (idx >= 0 && idx < selected.length) {
      defaultAgent = selected[idx].name;
    }
  }

  // Router mode
  console.log(chalk.bold("\n  Router mode:\n"));
  console.log(`    1) ${chalk.bold("manual")}  — always use default agent`);
  console.log(`    2) ${chalk.bold("rules")}   — route by regex rules`);
  console.log(`    3) ${chalk.bold("auto")}    — automatic routing`);

  const routerChoice = await ask(rl, `\n  Router mode [1]: `);
  const routerModes = ["manual", "rules", "auto"] as const;
  const routerIdx = routerChoice === "" ? 0 : parseInt(routerChoice, 10) - 1;
  const routerMode = routerModes[routerIdx] ?? "manual";

  rl.close();

  // Generate config
  const config = buildConfig(selected, defaultAgent, routerMode);
  const yamlContent = `# AgentMX Configuration\n# Generated by: amx init\n\n${stringify(config)}`;

  writeFileSync(configPath, yamlContent, "utf-8");

  console.log(
    chalk.green(`\n  Created ${chalk.bold(CONFIG_FILE)} successfully!`),
  );
  console.log(chalk.dim(`\n  Run ${chalk.bold("amx")} to start.\n`));
}
