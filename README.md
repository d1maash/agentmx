# AgentMX

Run multiple AI coding agents side-by-side in a single terminal. Switch between Claude Code, Codex CLI, Aider, Gemini CLI, GitHub Copilot CLI, Cursor Agent, Goose, or any custom agent with one TUI, one config file, and one workflow surface.

![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)
![npm](https://img.shields.io/npm/v/agentmx)

## Why AgentMX?

Different agents are good at different jobs. Claude Code is strong at larger refactors, Codex is fast on focused code tasks, Aider is tightly coupled to git, and newer CLIs keep shipping different strengths. AgentMX keeps them in one terminal so you can route, compare, chain, review, and resume work without juggling sessions manually.

## Features

- **Tabbed TUI** with live streaming output, input mode, scrolling, search, bookmarks, snippets, diff view, and a built-in dashboard
- **Task routing** that picks agents automatically from regex rules or falls back to the default agent
- **Parallel execution** for side-by-side comparison in split view
- **Pipelines** for sequential handoff between agents
- **Voting / consensus mode** where multiple agents answer the same task and a judge picks the best answer or merges them
- **Review pipeline** with dedicated coder, reviewer, and tester roles
- **Shared context mode** where agents see each other's live output as additional context
- **Saved sessions** with listing, deletion, and resume support
- **Analytics and cost tracking** based on saved session history, with per-agent and global budget alerts
- **Quality scoring** for linting, tests, and repository complexity
- **Benchmark suites** with generated Markdown reports
- **Custom agents** that wrap any CLI tool

## Install

```bash
npm install -g agentmx
```

Install at least one supported agent:

```bash
# Claude Code
npm install -g @anthropic-ai/claude-code

# Codex CLI
npm install -g @openai/codex

# Aider
pip install aider-chat
```

Requirements:

- Node.js >= 20
- At least one supported agent installed

## Quick Start

```bash
# Detect installed agents and create .agentmx.yml
amx init

# Launch the interactive TUI
amx

# Run one task with routing
amx run "fix the login race condition"

# Compare two agents side-by-side
amx run "write unit tests for auth.ts" -p claude-code,codex

# Let multiple agents answer and have a judge pick the winner
amx vote "design a migration plan for the billing schema" \
  --agents claude-code,codex \
  --judge claude-code

# Run coder -> reviewer -> tester
amx review "add pagination to the users endpoint"

# Run multiple agents with shared live context
amx share "investigate the flaky CI failure" --agents claude-code,codex

# Inspect historical usage
amx stats --days 14
amx costs
amx quality

# Resume or inspect previous sessions
amx sessions
amx resume
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `1-9` | Switch to agent tab |
| `Left / Right` or `Tab` | Move between tabs |
| `Enter` | Start typing input |
| `Esc` | Leave input mode or close overlays |
| `Up / Down` | Scroll output |
| `PgUp / PgDn` | Scroll by page |
| `Home / End` | Jump to top / bottom |
| `Ctrl+A` | Open analytics dashboard |
| `Ctrl+F` | Search current output |
| `Ctrl+B` | Add bookmark |
| `Ctrl+G` | Open bookmarks |
| `Ctrl+S` | Open snippets |
| `Ctrl+D` | Open diff view |
| `Ctrl+N` | Start a new agent |
| `Ctrl+W` | Kill current agent |
| `Ctrl+Q` | Quit |

Inside the dashboard, use `1`, `2`, and `3` to switch between overview, costs, and history tabs.

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
    args: ["--model", "o4-mini"]
    enabled: true

  aider:
    command: aider
    args: ["--model", "sonnet"]
    enabled: false

  gemini:
    command: gemini
    enabled: false

  copilot:
    command: copilot
    enabled: false

  cursor:
    command: cursor-agent
    enabled: false

  goose:
    command: goose
    enabled: false

  my-tool:
    command: my-tool
    args: ["--flag"]
    env:
      API_KEY: "..."
    enabled: true

router:
  mode: rules   # manual | rules | auto
  rules:
    - match: "test|spec|coverage"
      agent: codex
      reason: "Prefer Codex for test generation"

    - match: "refactor|clean|docs"
      agent: claude-code

ui:
  theme: dark
  split_view: vertical   # vertical | horizontal
```

AgentMX uses [cosmiconfig](https://github.com/cosmiconfig/cosmiconfig), so you can also use `.agentmxrc`, `.agentmxrc.json`, `.agentmxrc.yaml`, or an `agentmx` key in `package.json`.

## Commands

### `amx` / `amx interactive`

Launch the TUI. This is the default command.

### `amx run <task>`

Run a task with one agent or a parallel set of agents.

```bash
amx run "fix the memory leak in worker.ts"
amx run "generate API docs" --agent codex
amx run "review this pull request" --parallel claude-code,codex
```

### `amx bench <task>`

Benchmark one task across agents and compare timing, exit code, output size, and cost metadata when available.

```bash
amx bench "implement binary search" --agents claude-code,codex
```

### `amx bench suite`

Run curated suites with automated verification and write a Markdown report.

```bash
amx bench suite --list
amx bench suite --suite algorithms --agents claude-code,codex
amx bench suite --suite practical --output bench-report.md
```

### `amx pipe <steps...>`

Run a sequential handoff pipeline.

```bash
amx pipe \
  "codex: write tests for utils.ts" \
  "claude-code: refactor the tests"
```

### `amx vote <task>`

Run the same task on multiple agents, then ask a judge agent to choose the best candidate or merge them.

```bash
amx vote "implement retry logic for the webhook client" \
  --agents claude-code,codex,aider \
  --judge claude-code \
  --strategy best
```

### `amx review <task>`

Run a three-stage pipeline: coder, reviewer, tester.

```bash
amx review "add request tracing to the API" \
  --coder codex \
  --reviewer claude-code \
  --tester aider
```

If roles are omitted, AgentMX uses the default agent and, when possible, different enabled agents for the reviewer and tester stages.

### `amx share <task>`

Start multiple agents in split view and mirror their output to each other as context lines.

```bash
amx share "investigate intermittent Redis disconnects" --agents claude-code,codex
```

This mode requires at least two agents.

### `amx sessions` and `amx resume`

Inspect and manage saved sessions, then resume them later.

```bash
amx sessions
amx sessions --delete <session-id>
amx sessions --clear
amx resume
amx resume <session-id>
```

Claude Code sessions resume natively when a Claude session ID is available. Other agents resume in interactive mode with the previous transcript injected as context.

### `amx stats`

Show the analytics dashboard in the terminal.

```bash
amx stats
amx stats --days 30
amx stats --days 7 --no-daily
```

### `amx costs`

Show per-agent costs and budget alerts, or configure budgets.

```bash
amx costs
amx costs --budgets
amx costs --set-budget claude-code --daily 5 --monthly 100
amx costs --set-global-budget --daily 10 --weekly 50
```

### `amx quality`

Run lint, test, and complexity checks for the current repository or a target path.

```bash
amx quality
amx quality --path ../another-project
```

Current detection covers `biome` or `eslint` for linting; `vitest`, `jest`, `pytest`, `go test`, or `npm test` for tests; and a built-in line-count heuristic for complexity.

### `amx config`

Print the resolved configuration as JSON.

### `amx init`

Interactive setup wizard that detects known agents and creates `.agentmx.yml`.

## Session Data, Analytics, and Budgets

AgentMX stores session history under `~/.agentmx/sessions/*.json`. That history powers:

- `amx sessions`
- `amx resume`
- `amx stats`
- `amx costs`
- the TUI dashboard opened with `Ctrl+A`

Budget settings are stored separately in `~/.agentmx/budgets.json`.

Cost totals depend on adapters emitting cost metadata. Claude Code already provides structured cost events, so it is the primary source of cost and token analytics today.

## Supported Agents

| Agent | Display Name | Task Mode |
|-------|--------------|-----------|
| `claude-code` | Claude Code | Structured stream output with tool and cost metadata |
| `codex` | Codex CLI | JSONL streaming and approval-aware execution |
| `aider` | Aider | PTY-based adapter with git-oriented workflow |
| `gemini` | Gemini CLI | `gemini -p <task>` |
| `copilot` | GitHub Copilot CLI | `copilot -p <task>` |
| `cursor` | Cursor Agent | `cursor-agent -p <task>` |
| `goose` | Goose | `goose run --text <task>` |
| Custom | Any name | Any command configured in `.agentmx.yml` |

## Short Alias

Use `amx` instead of `agentmx` anywhere:

```bash
amx run "fix the bug"
amx vote "compare two SQL migration strategies" --agents claude-code,codex
```

## Documentation

Full documentation, command reference, and architecture notes are in [docs/guide.md](docs/guide.md).

## License

MIT
