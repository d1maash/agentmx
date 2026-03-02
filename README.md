# AgentMX

Run multiple AI coding agents side-by-side in a single terminal. Switch between Claude Code, Codex CLI, Aider, or any custom agent with tabs, route tasks automatically, chain agents into pipelines, or run them in parallel — all from one unified TUI.

![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)
![npm](https://img.shields.io/npm/v/agentmx)

## Why AgentMX?

Every AI coding agent has strengths. Claude Code is great at refactoring, Codex is fast at test generation, Aider knows your git history. But switching between terminals, copy-pasting context, and managing multiple sessions is painful.

AgentMX solves this. One terminal. All your agents. Zero context-switching.

## Features

- **Tabbed TUI** — Switch between agents with number keys or arrow keys
- **Task routing** — Automatically pick the best agent for each task based on regex rules
- **Pipelines** — Chain agents sequentially, passing output from one to the next
- **Benchmarking** — Compare agents head-to-head with timing, cost, and output metrics
- **Parallel execution** — Run the same task on multiple agents side-by-side in split view
- **Streaming output** — Real-time structured output with thinking blocks, tool calls, and cost tracking
- **Interactive input** — Send follow-up prompts to any running agent
- **Custom agents** — Wrap any CLI tool as an agent

## Install

```bash
npm install -g agentmx
```

Make sure you have at least one AI agent installed:

```bash
# Claude Code
npm install -g @anthropic-ai/claude-code

# Codex CLI
npm install -g @openai/codex

# Aider
pip install aider-chat
```

## Quick Start

```bash
# Launch interactive TUI
agentmx

# Run a task with the default agent
agentmx run "add input validation to the signup form"

# Run with a specific agent
agentmx run -a codex "write unit tests for auth.ts"

# Run on multiple agents in parallel
agentmx run -p claude-code,codex "optimize the database queries"

# Benchmark agents against each other
agentmx bench "write fibonacci in rust"
agentmx bench "fix the bug" --agents claude-code,codex

# Chain agents in a pipeline
agentmx pipe "codex: write tests for utils.ts" "claude-code: refactor the tests"
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `1-9` | Switch to agent tab |
| `← →` / `Tab` | Navigate between tabs |
| `Enter` | Start typing input |
| `Esc` | Exit input mode |
| `↑ ↓` | Scroll output |
| `PgUp / PgDn` | Scroll by page |
| `Home / End` | Jump to top / bottom |
| `Ctrl+N` | Start a new agent |
| `Ctrl+W` | Kill current agent |
| `Ctrl+Q` | Quit |

## Configuration

Create a `.agentmx.yml` in your project root:

```yaml
default_agent: claude-code

agents:
  claude-code:
    command: claude
    enabled: true

  codex:
    command: codex
    args: ["--model", "o4-mini", "-a", "on-request"]
    enabled: true

  aider:
    command: aider
    args: ["--model", "sonnet"]
    enabled: false

  # Add any CLI tool as a custom agent
  my-tool:
    command: my-tool
    args: ["--flag"]
    env:
      API_KEY: "..."
    enabled: true

router:
  mode: rules   # auto | rules | manual
  rules:
    - match: "test|spec|coverage"
      agent: codex
      reason: "Codex is great for test generation"

    - match: "refactor|clean"
      agent: claude-code

    - match: "docs|readme|comment"
      agent: claude-code

ui:
  theme: dark
  split_view: vertical   # vertical | horizontal
```

AgentMX uses [cosmiconfig](https://github.com/cosmiconfig/cosmiconfig), so you can also use `.agentmxrc`, `.agentmxrc.json`, `.agentmxrc.yaml`, or an `agentmx` key in `package.json`.

## Commands

### `agentmx` / `agentmx interactive`

Launch the interactive TUI. Start agents with `Ctrl+N`, switch between them with tabs, send input with `Enter`.

### `agentmx run <task>`

Run a single task.

```bash
agentmx run "fix the memory leak in worker.ts"
agentmx run -a codex "generate API docs"
agentmx run -p claude-code,codex "review this pull request"
```

| Flag | Description |
|------|-------------|
| `-a, --agent <name>` | Agent to use (default: auto-routed) |
| `-p, --parallel <agents>` | Comma-separated agents for parallel execution |

### `agentmx bench <task>`

Benchmark a task across agents and compare results side-by-side.

```bash
agentmx bench "write a hello world in python"
agentmx bench "implement binary search" --agents claude-code,codex
```

| Flag | Description |
|------|-------------|
| `-a, --agents <list>` | Comma-separated agents to benchmark (default: all enabled) |

Output:

```
Benchmark Results — "write a hello world in python"

  #  Agent         Time     Exit   Output    Cost
  ─────────────────────────────────────────────────
  1  Aider          6.2s      0     1.2 KB      —
  2  Codex          8.7s      0     3.4 KB      —
  3  Claude Code   12.3s      0     5.1 KB   $0.04

  Fastest: Aider (6.2s)
```

### `agentmx pipe <steps...>`

Run agents in a sequential pipeline. Each step's output is passed as context to the next.

```bash
agentmx pipe \
  "codex: find all security vulnerabilities" \
  "claude-code: fix the vulnerabilities found above"
```

### `agentmx config`

Print the resolved configuration as JSON.

## Task Routing

When you run `agentmx run "task"` without specifying an agent, the router picks one:

| Mode | Behavior |
|------|----------|
| `manual` | Always uses `default_agent` |
| `rules` | Matches task against regex rules in order, falls back to `default_agent` |
| `auto` | Rules-based with planned LLM classification fallback |

## Supported Agents

| Agent | Display Name | How it works |
|-------|-------------|--------------|
| `claude-code` | Claude Code | Structured stream-json output with thinking, tool calls, cost tracking |
| `codex` | Codex CLI | JSONL streaming with reasoning, command execution, approval flow |
| `aider` | Aider | PTY-based with git integration |
| Custom | Any name | Wrap any CLI command |

## Short Alias

Use `amx` instead of `agentmx` anywhere:

```bash
amx run "fix the bug"
amx pipe "codex: test" "claude-code: refactor"
```

## Requirements

- Node.js >= 20
- At least one AI coding agent installed (Claude Code, Codex, Aider, or custom)

## Documentation

Full documentation with architecture details, adapter system, and advanced usage is available in [docs/guide.md](docs/guide.md).

## License

MIT
