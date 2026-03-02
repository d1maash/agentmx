# AgentMX — Documentation

Full documentation for **agentmx** (alias `amx`) — multi-agent CLI orchestrator for AI coding agents.

---

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Commands](#commands)
  - [interactive](#interactive)
  - [run](#run)
  - [bench](#bench)
  - [pipe](#pipe)
  - [config](#config)
- [Configuration](#configuration)
  - [File Format](#file-format)
  - [Agent Configuration](#agent-configuration)
  - [Router Configuration](#router-configuration)
  - [UI Configuration](#ui-configuration)
- [Supported Agents](#supported-agents)
  - [Claude Code](#claude-code)
  - [Codex](#codex)
  - [Aider](#aider)
  - [Custom Agents](#custom-agents)
- [TUI Interface](#tui-interface)
  - [Keyboard Shortcuts](#keyboard-shortcuts)
  - [Views](#views)
  - [Status Bar](#status-bar)
- [Architecture](#architecture)
  - [Project Structure](#project-structure)
  - [Core Concepts](#core-concepts)
  - [Adapter System](#adapter-system)
  - [Process Manager](#process-manager)
  - [Pipeline Engine](#pipeline-engine)
  - [Task Router](#task-router)
- [Examples](#examples)

---

## Overview

AgentMX lets you run multiple AI coding agents (Claude Code, Codex, Aider and others) side-by-side in a single terminal. Instead of switching between tools, you get a unified TUI with tabs, split views, agent pipelines and benchmarking.

Key features:

- **Interactive TUI** — tabbed interface with live output streaming, scrolling and input
- **Parallel Execution** — run the same task on multiple agents simultaneously in split view
- **Benchmarking** — compare agents head-to-head with timing, output size and cost metrics
- **Pipelines** — chain agents sequentially, passing output from one to the next
- **Smart Routing** — route tasks to the right agent automatically based on regex rules
- **Extensible** — add any CLI tool as a custom agent via config

---

## Installation

```bash
# Clone and install
git clone https://github.com/d1maash/agentmx.git
cd agentmx
pnpm install
pnpm build

# Link globally
pnpm link --global
```

Requirements:

- Node.js >= 20
- pnpm
- At least one supported agent installed (claude, codex, aider, etc.)

After linking, two commands are available: `agentmx` and `amx` (shorter alias).

---

## Quick Start

```bash
# Launch interactive TUI
amx

# Run a task with the default agent
amx run "fix the login bug"

# Run on a specific agent
amx run "write tests for auth.ts" --agent codex

# Run on multiple agents in parallel (split view)
amx run "explain this code" --parallel claude-code,codex

# Benchmark agents against each other
amx bench "write a hello world in python"

# Chain agents in a pipeline
amx pipe "claude-code: analyze the bug" "codex: write a fix"

# Show current config
amx config
```

---

## Commands

### `interactive`

```
amx interactive
amx              # (default command)
```

Launches the full interactive TUI. This is the default when no command is specified.

In the TUI you can:
- Switch between agents with number keys or Tab
- Scroll output with arrow keys, PgUp/PgDn, Home/End
- Type messages to the active agent by pressing Enter
- Start new agent sessions with Ctrl+N
- Kill agents with Ctrl+W
- Quit with Ctrl+Q

### `run`

```
amx run <task> [options]
```

Runs a single task in the TUI and exits when done.

**Options:**

| Option | Description |
|---|---|
| `-a, --agent <name>` | Agent to use (default: `auto` — uses router) |
| `-p, --parallel <agents>` | Comma-separated agents for parallel execution |

**Examples:**

```bash
# Auto-route to best agent
amx run "refactor the auth module"

# Use a specific agent
amx run "write tests" --agent codex

# Parallel comparison in split view
amx run "explain this codebase" -p claude-code,codex,aider
```

When using `--parallel`, the TUI switches to split view mode, showing all agents side-by-side.

### `bench`

```
amx bench <task> [options]
```

Benchmark a task across agents and compare results. Runs all agents in parallel and produces a comparison table with timing, exit codes, output size, and cost.

**Options:**

| Option | Description |
|---|---|
| `-a, --agents <list>` | Comma-separated agent names (default: all enabled) |

**Examples:**

```bash
# Benchmark all enabled agents
amx bench "write a fibonacci function in rust"

# Benchmark specific agents
amx bench "fix the login bug" --agents claude-code,codex
```

**Output:**

While agents are running, a live progress view is shown:

```
amx bench — "write a fibonacci function in rust"

  Claude Code   ⏳ running   12.3s
  Codex         ⏳ running    8.7s
  Aider         ✅ done       6.2s
```

Once all agents finish, a results table appears:

```
Benchmark Results — "write a fibonacci function in rust"

  #  Agent         Time     Exit   Output    Cost
  ─────────────────────────────────────────────────
  1  Aider          6.2s      0     1.2 KB      —
  2  Codex          8.7s      0     3.4 KB      —
  3  Claude Code   12.3s      0     5.1 KB   $0.04

  Fastest: Aider (6.2s)
```

The results table is also printed to stdout after the TUI exits, so it's copy-pasteable.

Cost data is automatically extracted from Claude Code's structured activity output (`activity.kind === "cost"`).

### `pipe`

```
amx pipe <steps...>
```

Run agents in a sequential pipeline. Each step follows the format `"agent: task"`. The output of each agent is passed as context to the next one.

**Examples:**

```bash
# Two-step pipeline
amx pipe "claude-code: analyze the bug in auth.ts" "codex: write a fix based on the analysis"

# Three-step pipeline
amx pipe \
  "claude-code: review this PR for security issues" \
  "codex: suggest fixes for the issues found" \
  "aider: apply the suggested fixes"
```

Pipeline output is printed sequentially to stdout with step headers.

### `config`

```
amx config
```

Prints the resolved configuration as JSON. Useful for debugging which agents are enabled and what settings are active.

---

## Configuration

### File Format

AgentMX uses [cosmiconfig](https://github.com/cosmiconfig/cosmiconfig) for configuration. It searches for config in the following locations (in order):

- `.agentmxrc`
- `.agentmxrc.json`
- `.agentmxrc.yaml` / `.agentmxrc.yml`
- `.agentmx.yml` / `.agentmx.yaml`
- `agentmx.config.js`
- `agentmx.config.ts`
- `package.json` (`"agentmx"` key)

Place the config file in your project root. An example is provided in `.agentmx.example.yml`.

### Agent Configuration

```yaml
default_agent: claude-code

agents:
  claude-code:
    command: claude
    args: []
    env: {}
    enabled: true

  codex:
    command: codex
    args: ["--model", "o4-mini", "-a", "on-request"]
    env: {}
    enabled: true

  aider:
    command: aider
    args: ["--model", "sonnet"]
    enabled: false

  # Custom agent example
  my-tool:
    command: my-custom-cli
    args: ["--flag"]
    env:
      API_KEY: "..."
    enabled: true
```

| Field | Type | Default | Description |
|---|---|---|---|
| `command` | string | required | CLI command to execute |
| `args` | string[] | `[]` | Default arguments |
| `env` | object | `{}` | Additional environment variables |
| `enabled` | boolean | `true` | Whether the agent is available |

### Router Configuration

The router determines which agent handles a task when using `--agent auto` (the default for `amx run`).

```yaml
router:
  mode: rules    # auto | rules | manual
  rules:
    - match: "test|spec|coverage"
      agent: codex
      reason: "Codex is great for test generation"

    - match: "refactor|clean"
      agent: claude-code

    - match: "docs|readme|comment"
      agent: claude-code
```

**Modes:**

| Mode | Behavior |
|---|---|
| `manual` | Always uses `default_agent` (no routing) |
| `rules` | Matches task text against regex rules (case-insensitive). Falls back to `default_agent` |
| `auto` | Reserved for future LLM-based routing. Currently behaves like `rules` |

### UI Configuration

```yaml
ui:
  theme: dark          # dark | light
  show_tokens: false   # Show token usage
  show_cost: false     # Show cost in status bar
  split_view: vertical # vertical | horizontal — layout for parallel mode
```

---

## Supported Agents

### Claude Code

Anthropic's CLI coding agent. AgentMX uses **stream-json** mode for structured output when running tasks, providing rich activity data:

- **Thinking** blocks (collapsible)
- **Tool calls** — Read, Write, Edit, Bash, Glob, Grep, WebSearch, etc.
- **Tool results** — with truncation for large outputs
- **Cost tracking** — total cost and duration per session

Interactive sessions use a text bridge for seamless two-way communication.

Environment isolation: AgentMX strips `CLAUDE_CODE_*` env vars to enable nested Claude Code invocations.

### Codex

OpenAI's CLI coding agent. Supports two modes:

- **Task mode**: `codex exec <task>` — runs a task and exits
- **Interactive mode**: text bridge with JSON event parsing (`thread.started`, `turn.completed`, etc.)

Thread resumption is supported via `--resume <threadId>` for stateful sessions.

### Aider

Paul Gauthier's AI pair programming tool. Runs with `--message <task>` for task mode or in raw PTY mode for interactive use.

### Custom Agents

Any CLI tool can be used as an agent. Define it in the config:

```yaml
agents:
  my-agent:
    command: my-cli-tool
    args: ["--some-flag"]
    env:
      CUSTOM_VAR: "value"
    enabled: true
```

Custom agents run in raw PTY mode and display unprocessed output.

---

## TUI Interface

### Keyboard Shortcuts

| Key | Action |
|---|---|
| `1`-`9` | Switch to agent tab N |
| `Tab` / `Left` / `Right` | Navigate between tabs |
| `Up` / `Down` | Scroll output |
| `PgUp` / `PgDn` | Page scroll (10 lines) |
| `Home` / `End` | Jump to top / bottom |
| `Enter` | Focus input (type a message) |
| `Esc` | Unfocus input (back to view mode) |
| `Ctrl+N` | Start a new agent session |
| `Ctrl+W` | Kill current agent |
| `Ctrl+Q` | Quit |

### Views

**Tab View** (default) — shows one agent at a time with a tab bar at the top:

```
 1:Claude Code ●  2:Codex ●  3:Aider ○
┌──────────────────────────────────────┐
│ Agent output here...                 │
│                                      │
└──────────────────────────────────────┘
```

**Split View** — used with `--parallel`, shows all agents side-by-side:

```
┌─ Claude Code (running) ─┬─ Codex (running) ─┐
│ Output...                │ Output...          │
│                          │                    │
└──────────────────────────┴────────────────────┘
```

The split direction is configurable: `vertical` (columns) or `horizontal` (rows).

**Activity View** — for Claude Code, shows structured output with formatted tool calls, thinking blocks, and cost summaries instead of raw text.

### Status Bar

The bottom status bar shows:

- Agent name and status (color-coded)
- Uptime (on wide terminals)
- Current tool name (if agent is using a tool)
- Scroll position indicator (`live` or offset like `-5`)
- Input/View mode indicator
- Keyboard hints (responsive to terminal width)

---

## Architecture

### Project Structure

```
src/
├── cli/
│   ├── index.ts                # Entry point — Commander setup
│   └── commands/
│       ├── interactive.ts      # Interactive TUI command
│       ├── run.ts              # Run task command
│       ├── bench.ts            # Benchmark command
│       └── pipe.ts             # Pipeline command
├── adapters/
│   ├── types.ts                # AgentAdapter, AgentProcess, AgentOutput types
│   ├── factory.ts              # createAdapters() factory
│   ├── claude-code.ts          # Claude Code adapter (stream-json + text bridge)
│   ├── codex.ts                # Codex adapter (exec + JSON events)
│   ├── aider.ts                # Aider adapter
│   ├── custom.ts               # Generic custom agent adapter
│   └── pty-helpers.ts          # PTY spawning utilities
├── core/
│   ├── process-manager.ts      # ProcessManager — lifecycle management
│   ├── session.ts              # Session interface & helpers
│   ├── router.ts               # Task routing engine
│   └── pipeline.ts             # Pipeline execution engine
├── config/
│   ├── schema.ts               # Zod validation schemas
│   ├── loader.ts               # cosmiconfig loader
│   └── defaults.ts             # Default config values
└── tui/
    ├── App.tsx                 # Root Ink component
    ├── components/
    │   ├── AgentTabs.tsx       # Tab bar
    │   ├── AgentView.tsx       # Output viewer (Activity + Session modes)
    │   ├── BenchView.tsx       # Benchmark live progress + results
    │   ├── SplitView.tsx       # Parallel split layout
    │   ├── InputBar.tsx        # Text input
    │   └── StatusBar.tsx       # Status line
    ├── hooks/
    │   ├── useAgents.ts        # Session state management
    │   └── useKeyboard.ts      # Keyboard input handling
    └── utils/
        └── terminal.ts         # ANSI stripping, viewport calculation
```

### Core Concepts

**AgentAdapter** — interface for integrating a CLI agent. Each adapter knows how to spawn the agent, parse its output, and handle its specific protocol.

```typescript
interface AgentAdapter {
  readonly info: AgentInfo;          // name, displayName, command, etc.
  checkInstalled(): Promise<boolean>;
  spawn(task: string, options?: SpawnOptions): AgentProcess;
}
```

**AgentProcess** — handle to a running agent. Provides async output stream, input sending, status tracking, and the accumulated output buffer.

```typescript
interface AgentProcess {
  send(input: string): void;
  output: AsyncIterable<AgentOutput>;
  status: AgentStatus;               // "idle" | "spawning" | "running" | "error" | "done"
  buffer: AgentOutput[];
  kill(): Promise<void>;
  done: Promise<{ exitCode: number }>;
  onData(listener: (data: string) => void): () => void;
  resize(cols: number, rows: number): void;
}
```

**AgentOutput** — a chunk of agent output, with optional structured activity metadata.

```typescript
interface AgentOutput {
  type: "stdout" | "stderr" | "system";
  data: string;
  timestamp: number;
  activity?: ClaudeActivity;        // Structured metadata (Claude Code only)
}
```

**ClaudeActivity** — structured events from Claude Code's stream-json:

| Kind | Data | Description |
|---|---|---|
| `init` | model, sessionId, tools | Session started |
| `thinking` | text | Claude's thinking/reasoning |
| `text` | text | Response text |
| `tool_call` | toolName, toolId, input | Tool invocation |
| `tool_result` | toolId, content, isError | Tool result |
| `cost` | totalCost, durationMs, usage | Session cost summary |

### Adapter System

Adapters are created by `createAdapters(config)` which reads the config and instantiates the appropriate adapter class for each enabled agent:

- `claude-code` -> `ClaudeCodeAdapter` (stream-json parsing, text bridge for interactive)
- `codex` -> `CodexAdapter` (exec mode, JSON event parsing)
- `aider` -> `AiderAdapter` (raw PTY)
- anything else -> `CustomAdapter` (generic PTY wrapper)

### Process Manager

`ProcessManager` is an EventEmitter that manages agent session lifecycle:

- `start(adapter, task)` -> spawns agent, returns session ID
- `get(id)` -> returns `AgentProcess`
- `getSession(id)` -> returns full `Session` (includes startedAt, agentName, task)
- `getSessions()` -> all active sessions
- `send(id, input)` -> sends text to agent stdin
- `stop(id)` / `stopAll()` -> kills agent(s)

Events emitted:
- `session:start` — agent spawned
- `session:end` — agent exited (with exit code)
- `session:stop` — agent manually stopped

### Pipeline Engine

The `Pipeline` class executes a sequence of agent steps:

1. Spawns the first agent with the task
2. Collects its full output
3. Spawns the next agent with its task + the previous agent's output as context
4. Repeats until all steps complete

```typescript
const pipeline = new Pipeline(steps, processManager, adapters);
for await (const { step, agent, output } of pipeline.execute()) {
  // process output
}
```

### Task Router

The `Router` selects the right agent for a task based on the configured mode:

- **manual** — always returns `default_agent`
- **rules** — matches task text against regex patterns, first match wins
- **auto** — reserved for LLM-based routing (currently falls back to rules)

---

## Examples

### Compare Claude Code vs Codex on a coding task

```bash
amx bench "implement binary search in TypeScript" --agents claude-code,codex
```

### Run all agents in parallel

```bash
amx run "explain what this repository does" -p claude-code,codex,aider
```

### Build a review pipeline

```bash
amx pipe \
  "claude-code: review src/auth.ts for security vulnerabilities" \
  "codex: write fixes for the vulnerabilities found"
```

### Use routing rules for automatic agent selection

`.agentmx.yml`:

```yaml
default_agent: claude-code
router:
  mode: rules
  rules:
    - match: "test|spec"
      agent: codex
    - match: "refactor|clean"
      agent: claude-code
```

```bash
# Routes to codex (matches "test")
amx run "write unit tests for the auth module"

# Routes to claude-code (matches "refactor")
amx run "refactor the database layer"
```

### Add a custom agent

`.agentmx.yml`:

```yaml
agents:
  cursor:
    command: cursor
    args: ["--cli"]
    enabled: true
```

```bash
amx run "fix the bug" --agent cursor
```
