# AgentMX

Run multiple AI coding agents side-by-side in a single terminal.

![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)
![npm](https://img.shields.io/npm/v/agentmx)

AgentMX (`amx`) is a CLI multiplexer for AI coding agents — Claude Code, Codex CLI, Aider, Gemini CLI, GitHub Copilot CLI, Cursor Agent, Goose, or any custom CLI. One TUI, one config, one workflow.

## Why?

Different agents excel at different tasks. Claude Code handles large refactors well, Codex is fast on focused code, Aider is tightly coupled to git. Instead of juggling terminals, AgentMX keeps them all in one place — route, compare, chain, review, and resume without switching contexts.

## Features

| Feature | Description |
|---------|-------------|
| **Tabbed TUI** | Live streaming, input, scrolling, search, bookmarks, snippets, diff view |
| **Task routing** | Auto-pick agents via regex rules or manual selection |
| **Parallel execution** | Side-by-side comparison in split view |
| **Pipelines** | Sequential handoff between agents |
| **Voting / consensus** | Multiple agents answer, a judge picks the best or merges |
| **Review pipeline** | Coder → reviewer → tester workflow |
| **Shared context** | Agents see each other's live output |
| **Sessions** | Save, list, resume previous work |
| **Analytics & costs** | Usage stats, per-agent costs, budget alerts |
| **Quality scoring** | Lint, test, and complexity checks |
| **Benchmarks** | Suites with generated Markdown reports |

## Quick Start

```bash
# Install
npm install -g agentmx

# Setup — detects installed agents and creates .agentmx.yml
amx init

# Launch interactive TUI
amx

# Run a task with auto-routing
amx run "fix the login race condition"

# Compare agents side-by-side
amx run "write unit tests for auth.ts" -p claude-code,codex

# Consensus with a judge
amx vote "design a migration plan" --agents claude-code,codex --judge claude-code

# Code review pipeline
amx review "add pagination to the users endpoint"

# Shared investigation
amx share "investigate the flaky CI failure" --agents claude-code,codex
```

**Requirements:** Node.js >= 20 and at least one [supported agent](docs/getting-started.md#supported-agents).

## Supported Agents

| Agent | Command | Notes |
|-------|---------|-------|
| Claude Code | `claude` | Structured streaming, cost metadata, native resume |
| Codex CLI | `codex` | JSONL streaming, approval-aware |
| Aider | `aider` | PTY-based, git-oriented |
| Gemini CLI | `gemini` | PTY adapter |
| GitHub Copilot CLI | `copilot` | PTY adapter |
| Cursor Agent | `cursor-agent` | PTY adapter |
| Goose | `goose` | PTY adapter |
| Custom | Any CLI | User-defined in config |

## Documentation

| Document | Description |
|----------|-------------|
| [Getting Started](docs/getting-started.md) | Installation, setup, and first steps |
| [Commands](docs/commands.md) | Full CLI command reference |
| [Configuration](docs/configuration.md) | Config file format, routing, custom agents |
| [TUI Guide](docs/tui.md) | Keyboard shortcuts, dashboard, sessions |
| [Orchestration](docs/orchestration.md) | Pipelines, voting, review, shared context |
| [Analytics & Costs](docs/analytics.md) | Usage stats, budgets, quality scoring |
| [Architecture](docs/architecture.md) | Project structure and internals |
| [Examples](docs/examples.md) | Practical usage recipes |
| [Contributing](CONTRIBUTING.md) | Development setup and guidelines |
| [Changelog](CHANGELOG.md) | Version history |

## License

MIT
