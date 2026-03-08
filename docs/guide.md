# AgentMX Guide

Full documentation for `agentmx` (`amx`) - a multi-agent CLI orchestrator for AI coding agents.

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Commands](#commands)
  - [interactive](#interactive)
  - [run](#run)
  - [bench](#bench)
  - [bench suite](#bench-suite)
  - [pipe](#pipe)
  - [vote](#vote)
  - [review](#review)
  - [share](#share)
  - [sessions](#sessions)
  - [resume](#resume)
  - [stats](#stats)
  - [costs](#costs)
  - [quality](#quality)
  - [config](#config)
  - [init](#init)
- [Configuration](#configuration)
  - [File Format](#file-format)
  - [Routing](#routing)
  - [Custom Agents](#custom-agents)
- [TUI](#tui)
  - [Keyboard Shortcuts](#keyboard-shortcuts)
  - [Dashboard](#dashboard)
  - [Saved Sessions](#saved-sessions)
- [Analytics and Budgets](#analytics-and-budgets)
- [Supported Agents](#supported-agents)
- [Architecture](#architecture)
  - [Project Structure](#project-structure)
  - [Core Runtime](#core-runtime)
  - [Orchestration Modes](#orchestration-modes)
- [Examples](#examples)

## Overview

AgentMX gives you one terminal interface for running multiple AI coding agents:

- Claude Code
- Codex CLI
- Aider
- Gemini CLI
- GitHub Copilot CLI
- Cursor Agent
- Goose
- Any custom CLI you define in config

The project is built around a few ideas:

- keep all agent sessions in one TUI
- route tasks automatically when you do not care which agent handles them
- compare multiple agents on the same problem
- chain or coordinate agents when one answer is not enough
- persist session history so you can resume, analyze, and budget usage later

Key capabilities:

- interactive TUI with tabs, split view, search, bookmarks, snippets, diff view, and dashboard
- single-task execution with automatic routing
- parallel runs and benchmark comparisons
- pipeline workflows
- voting / consensus workflows with a judge agent
- review pipeline with coder, reviewer, tester stages
- shared-context mode that mirrors live output between agents
- saved sessions, analytics, cost tracking, and budget alerts
- repository quality scoring
- benchmark suites with generated Markdown reports

## Installation

### From npm

```bash
npm install -g agentmx
```

### From source

```bash
git clone https://github.com/d1maash/agentmx.git
cd agentmx
pnpm install
pnpm build
pnpm link --global
```

Requirements:

- Node.js >= 20
- pnpm if building from source
- at least one supported agent installed on your machine

Install examples:

```bash
# Claude Code
npm install -g @anthropic-ai/claude-code

# Codex CLI
npm install -g @openai/codex

# Aider
pip install aider-chat
```

After installation, both `agentmx` and `amx` are available.

## Quick Start

```bash
# Detect installed agents and create .agentmx.yml
amx init

# Launch the interactive TUI
amx

# Run one task with routing
amx run "fix the memory leak in the worker pool"

# Run one task on specific agents side-by-side
amx run "write tests for auth.ts" --parallel claude-code,codex

# Benchmark one task
amx bench "implement binary search in TypeScript" --agents claude-code,codex

# Run a benchmark suite
amx bench suite --list
amx bench suite --suite algorithms --agents claude-code,codex

# Sequential handoff
amx pipe \
  "codex: write tests for utils.ts" \
  "claude-code: refactor the implementation"

# Let multiple agents answer and have a judge choose
amx vote "design a caching strategy for the API layer" \
  --agents claude-code,codex,aider \
  --judge claude-code

# Run coder -> reviewer -> tester
amx review "add pagination to the users endpoint"

# Run multiple agents with shared live context
amx share "investigate the flaky CI failure" --agents claude-code,codex

# Inspect saved usage and quality
amx sessions
amx stats --days 14
amx costs
amx quality
```

## Commands

### interactive

```bash
amx
amx interactive
```

Launch the interactive TUI. This is the default command when you run `amx` without arguments.

Use it when you want:

- long-running interactive sessions
- tabbed switching between agents
- split-view comparisons
- search, bookmarks, snippets, or diff view
- the built-in dashboard opened with `Ctrl+A`

### run

```bash
amx run <task> [options]
```

Run a single task using one agent or a parallel set of agents.

Options:

| Option | Description |
|---|---|
| `-a, --agent <name>` | Agent to use. Default is `auto`, which lets the router choose. |
| `-p, --parallel <agents>` | Comma-separated agents to run side-by-side in split view. |

Examples:

```bash
# Auto-route
amx run "refactor the auth module"

# Explicit agent
amx run "generate API docs" --agent codex

# Parallel comparison
amx run "review this patch" --parallel claude-code,codex,aider
```

When `--parallel` is used, AgentMX launches the TUI in split view and starts each listed agent with the same task.

### bench

```bash
amx bench <task> [options]
```

Benchmark one task across multiple agents and compare:

- total execution time
- exit code
- output size
- cost metadata when available

Options:

| Option | Description |
|---|---|
| `-a, --agents <list>` | Comma-separated agent names. Defaults to all enabled agents. |

Examples:

```bash
amx bench "write a fibonacci function in Rust"
amx bench "fix the login bug" --agents claude-code,codex
```

### bench suite

```bash
amx bench suite [options]
```

Run curated benchmark suites with automated verification. This is separate from `amx bench <task>`.

Options:

| Option | Description |
|---|---|
| `-s, --suite <id>` | Run one specific suite, such as `algorithms` or `practical`. |
| `-a, --agents <list>` | Comma-separated agents to benchmark. |
| `-o, --output <path>` | Path for the generated Markdown report. |
| `--list` | List available suites and exit. |
| `--keep-workspaces` | Keep temp workspaces after the run. |

Examples:

```bash
amx bench suite --list
amx bench suite --suite algorithms --agents claude-code,codex
amx bench suite --suite practical --output bench-report.md
```

If no output path is given, AgentMX writes a report like `bench-report-<timestamp>.md`.

### pipe

```bash
amx pipe <steps...>
```

Run agents in sequence. Each step is written as `"agent: task"`. Output from earlier steps becomes context for later steps.

Examples:

```bash
amx pipe \
  "codex: find all security issues in src/auth.ts" \
  "claude-code: fix the issues listed above"

amx pipe \
  "claude-code: summarize this repository" \
  "codex: write onboarding docs based on that summary"
```

### vote

```bash
amx vote <task> [options]
```

Run the same task on multiple agents, then ask a judge agent to evaluate the results.

Options:

| Option | Description |
|---|---|
| `-a, --agents <list>` | Comma-separated agents to run. Defaults to all enabled agents. |
| `-j, --judge <agent>` | Judge agent. Defaults to the first agent in the list. |
| `-s, --strategy <strategy>` | Either `best` or `merge`. Default is `best`. |

Behavior:

- at least two agents are required
- phase 1 collects all candidate responses
- phase 2 runs the judge agent with the full set of candidates
- `best` expects the judge to start with `WINNER: Candidate N`
- `merge` asks the judge to combine the strongest parts of all candidates

Examples:

```bash
amx vote "implement retry logic for the webhook client" \
  --agents claude-code,codex,aider \
  --judge claude-code \
  --strategy best

amx vote "draft a rollout plan for the migration" \
  --agents claude-code,codex \
  --strategy merge
```

### review

```bash
amx review <task> [options]
```

Run a three-stage review pipeline:

1. coder writes the implementation
2. reviewer critiques the result
3. tester writes tests using both the original task and the review feedback

Options:

| Option | Description |
|---|---|
| `--coder <agent>` | Agent used for implementation. |
| `--reviewer <agent>` | Agent used for code review. |
| `--tester <agent>` | Agent used for writing tests. |

Defaults:

- the coder defaults to `default_agent`
- the reviewer defaults to a different enabled agent when possible
- the tester defaults to another different enabled agent when possible
- if not enough agents are enabled, roles fall back to the default agent

Example:

```bash
amx review "add request tracing to the API" \
  --coder codex \
  --reviewer claude-code \
  --tester aider
```

### share

```bash
amx share <task> [options]
```

Run a task on multiple agents in split view with real-time context sharing between them.

Options:

| Option | Description |
|---|---|
| `-a, --agents <list>` | Comma-separated agents to run. Defaults to all enabled agents. |

Behavior:

- requires at least two agents
- each running session is connected to a shared context bus
- when one agent emits output, AgentMX forwards it to other agents as context
- long bursts are truncated before forwarding to reduce flooding

Example:

```bash
amx share "debug the production-only timeout issue" --agents claude-code,codex
```

This mode is useful for collaborative investigation, but it is intentionally lightweight: it mirrors output as plain text rather than trying to maintain a formal shared state model.

### sessions

```bash
amx sessions [options]
```

List, delete, or clear saved sessions.

Options:

| Option | Description |
|---|---|
| `--delete <id>` | Delete a single saved session. |
| `--clear` | Delete all saved sessions. |

Examples:

```bash
amx sessions
amx sessions --delete 0f4a4d6d-...
amx sessions --clear
```

Saved sessions are sorted by most recent completion time.

### resume

```bash
amx resume [session-id]
```

Resume a previously saved session.

Behavior:

- if a session ID is passed, AgentMX resumes that session directly
- if no session ID is passed, AgentMX opens a picker in the terminal
- Claude Code sessions use native resume when the saved transcript contains a Claude session ID
- other agents restart in interactive mode with the previous transcript injected as context

Examples:

```bash
amx resume
amx resume <session-id>
```

### stats

```bash
amx stats [options]
```

Show analytics derived from saved session history.

Options:

| Option | Description |
|---|---|
| `-d, --days <n>` | Limit the report to the last `n` days. |
| `--no-daily` | Hide the daily breakdown table. |
| `--no-weekly` | Hide the weekly breakdown table. |

The report includes:

- total sessions
- overall success rate
- total cost when available
- total runtime
- per-agent statistics
- daily breakdown
- weekly breakdown

Examples:

```bash
amx stats
amx stats --days 30
amx stats --days 7 --no-daily
```

### costs

```bash
amx costs [options]
```

Inspect per-agent costs, view budget alerts, or configure budgets.

Options:

| Option | Description |
|---|---|
| `--set-budget <agent>` | Set per-agent budget limits. |
| `--set-global-budget` | Set global budget limits. |
| `--daily <amount>` | Daily USD limit. |
| `--weekly <amount>` | Weekly USD limit. |
| `--monthly <amount>` | Monthly USD limit. |
| `--total <amount>` | Total cumulative USD limit for a single agent. |
| `--budgets` | Show current budget configuration without the cost table. |

Examples:

```bash
amx costs
amx costs --budgets
amx costs --set-budget claude-code --daily 5 --weekly 20 --monthly 60 --total 200
amx costs --set-global-budget --daily 10 --weekly 50 --monthly 200
```

Notes:

- alerts are warnings at 80% of a budget and exceeded at 100%
- budgets are informational today; they surface alerts but do not hard-block execution
- a pre-start budget check runs before new agent sessions are launched

### quality

```bash
amx quality [options]
```

Run a repository quality scan across three areas:

- linting
- tests
- codebase complexity

Options:

| Option | Description |
|---|---|
| `-p, --path <dir>` | Directory to analyze. Defaults to the current working directory. |

Current detection logic:

- lint: `biome` or `eslint`
- test: `vitest`, `jest`, `pytest`, `go test`, or fallback `npm test`
- complexity: built-in line-count heuristic across common source extensions

Examples:

```bash
amx quality
amx quality --path ../service-api
```

The overall score is a weighted aggregate of available checks:

- tests: weight 4
- linting: weight 3
- complexity: weight 2

### config

```bash
amx config
```

Print the fully resolved configuration as JSON.

Useful for checking:

- which config file was resolved
- which agents are enabled
- router behavior
- final defaults after merging config sources

### init

```bash
amx init
```

Interactive setup wizard that detects known agents, asks which ones to enable, and writes `.agentmx.yml`.

The wizard currently scans for common installations such as:

- `claude`
- `codex`
- `aider`

## Configuration

### File Format

Create `.agentmx.yml` in your project root:

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

AgentMX uses `cosmiconfig`, so the following are also supported:

- `.agentmxrc`
- `.agentmxrc.json`
- `.agentmxrc.yaml`
- `agentmx` field inside `package.json`

### Routing

When `amx run` is called without an explicit agent, the router chooses one:

| Mode | Behavior |
|---|---|
| `manual` | Always use `default_agent`. |
| `rules` | Match regex rules in order, then fall back to `default_agent`. |
| `auto` | Currently rules-first with room for future classifier-driven behavior. |

Example:

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

Then:

```bash
amx run "write unit tests for auth.ts"   # routes to codex
amx run "refactor the data layer"        # routes to claude-code
```

### Custom Agents

Any CLI can be wrapped as an agent:

```yaml
agents:
  my-agent:
    command: my-agent-cli
    args: ["--flag"]
    env:
      API_KEY: "..."
    enabled: true
```

Then run it directly:

```bash
amx run "fix the bug" --agent my-agent
```

## TUI

### Keyboard Shortcuts

| Key | Action |
|---|---|
| `1-9` | Jump to agent tab by index |
| `Left / Right` | Move to previous or next tab |
| `Tab` | Cycle tabs |
| `Enter` | Enter input mode |
| `Esc` | Exit input mode or close overlays |
| `Up / Down` | Scroll output |
| `PgUp / PgDn` | Page scroll |
| `Home / End` | Jump to top / bottom |
| `Ctrl+A` | Open analytics dashboard |
| `Ctrl+F` | Search current output |
| `Ctrl+B` | Add bookmark |
| `Ctrl+G` | Open bookmark list |
| `Ctrl+S` | Open snippet picker |
| `Ctrl+D` | Open diff view |
| `Ctrl+N` | Create a new agent session |
| `Ctrl+W` | Kill the current agent |
| `Ctrl+Q` | Quit |

### Dashboard

Press `Ctrl+A` inside the TUI to open the dashboard view.

Tabs:

| Key | Tab | Contents |
|---|---|---|
| `1` | Overview | Session totals, success rate, per-agent stats, token usage when available |
| `2` | Costs | Per-agent cost breakdown and totals |
| `3` | History | Daily and weekly trends |

The dashboard also shows active budget warnings or exceeded budgets in a banner when present.

### Saved Sessions

Finished sessions are persisted under:

```text
~/.agentmx/sessions/*.json
```

Each saved session contains:

- session ID
- agent name
- original task
- timestamps
- exit code and final status
- working directory
- serialized output buffer

That saved history powers:

- `amx sessions`
- `amx resume`
- `amx stats`
- `amx costs`
- the TUI dashboard

## Analytics and Budgets

Analytics and budget tracking are built on top of saved sessions.

What gets computed:

- total session count
- success and error counts
- total and average run duration
- total and average cost when cost metadata exists
- daily breakdown by date
- weekly breakdown by Monday-to-Sunday range
- token totals when adapters emit token usage

Budget config is stored in:

```text
~/.agentmx/budgets.json
```

Budget scopes:

- per-agent daily, weekly, monthly, and total limits
- global daily, weekly, and monthly limits

Important limitation:

- cost and token numbers depend on adapters emitting structured cost events
- Claude Code already provides these events, so Claude sessions are currently the main source of budget and token data

## Supported Agents

| Agent | Display Name | Notes |
|---|---|---|
| `claude-code` | Claude Code | Structured stream output with tool calls, cost events, and resume support |
| `codex` | Codex CLI | JSONL streaming with reasoning and approval-aware execution |
| `aider` | Aider | PTY-based workflow with git-oriented interaction |
| `gemini` | Gemini CLI | PTY adapter using `gemini -p <task>` for task mode |
| `copilot` | GitHub Copilot CLI | PTY adapter using `copilot -p <task>` for task mode |
| `cursor` | Cursor Agent | PTY adapter using `cursor-agent -p <task>` for task mode |
| `goose` | Goose | PTY adapter using `goose run --text <task>` for task mode |
| Custom | Any configured name | Any CLI wrapped through config |

## Architecture

### Project Structure

```text
src/
  adapters/          # Agent adapters and adapter factory
  bench/             # Benchmark problems, suites, orchestration, reports
  cli/
    commands/        # interactive, run, bench, bench-suite, pipe, vote,
                     # review, share, sessions, resume, stats, costs, quality, init
  config/            # Schema, loader, defaults
  core/              # Process manager, router, pipeline, session store,
                     # analytics, cost tracker, voting, review pipeline, context bus
  tui/
    components/      # Main TUI views, status bar, diff, dashboard, suite view
    hooks/           # Keyboard handling, agent lifecycle hooks
    utils/           # Bookmarks, snippets, terminal helpers
```

### Core Runtime

Main pieces:

- **ProcessManager**: starts agent processes, tracks session lifecycle, saves finished sessions, and performs budget checks before launching new work
- **SessionStore**: persists finished sessions under `~/.agentmx/sessions`
- **Task Router**: chooses an agent for `amx run` when routing is enabled
- **Pipeline Engine**: passes output from one step to the next in `amx pipe`
- **ContextBus**: mirrors live output between running sessions in `amx share`
- **VotingSession**: coordinates parallel candidates plus a judge in `amx vote`
- **ReviewPipeline**: coordinates coder, reviewer, and tester stages in `amx review`
- **Analytics**: aggregates saved session history into agent, daily, and weekly summaries
- **CostTracker**: computes cost totals and budget alerts from saved sessions
- **QualityScorer**: runs lint, test, and complexity checks against a target path

### Orchestration Modes

AgentMX now has several distinct orchestration styles:

| Mode | Command | Best for |
|---|---|---|
| Single-agent execution | `amx run` | Normal day-to-day work |
| Parallel comparison | `amx run --parallel` | Watching multiple agents tackle one task live |
| Benchmarking | `amx bench` | Comparing one task objectively |
| Verified suites | `amx bench suite` | Repeatable benchmark runs with reports |
| Sequential handoff | `amx pipe` | Stage-based collaboration |
| Consensus / judging | `amx vote` | Best-of-N or merged answers |
| Structured code review | `amx review` | Implementation plus review plus tests |
| Shared live context | `amx share` | Collaborative investigation |

## Examples

### Compare two agents on one task

```bash
amx run "explain what this repository does" --parallel claude-code,codex
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
amx run "write unit tests for the auth module"
amx run "refactor the database layer"
```

### Run a review workflow

```bash
amx review "add retry logic to the webhook worker" \
  --coder codex \
  --reviewer claude-code \
  --tester aider
```

### Pick the best answer with a judge

```bash
amx vote "design a migration strategy for the billing schema" \
  --agents claude-code,codex,aider \
  --judge claude-code \
  --strategy best
```

### Merge the best parts of multiple answers

```bash
amx vote "draft a launch checklist for the new CLI release" \
  --agents claude-code,codex \
  --strategy merge
```

### Investigate an issue collaboratively

```bash
amx share "debug the production-only timeout issue" --agents claude-code,codex
```

### Configure budgets

```bash
amx costs --set-budget claude-code --daily 5 --monthly 100
amx costs --set-global-budget --weekly 50
amx costs
```

### Resume a previous session

```bash
amx sessions
amx resume <session-id>
```
