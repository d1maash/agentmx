# Getting Started

## Installation

### From npm

```bash
npm install -g agentmx
```

### From source

```bash
git clone https://github.com/d1maash/agentmux.git
cd agentmx
pnpm install
pnpm build
pnpm link --global
```

After installation, both `agentmx` and `amx` are available as commands.

### Requirements

- Node.js >= 20
- pnpm (if building from source)
- At least one supported agent installed

### Installing Agents

```bash
# Claude Code
npm install -g @anthropic-ai/claude-code

# Codex CLI
npm install -g @openai/codex

# Aider
pip install aider-chat
```

## Setup

Run the interactive wizard to detect agents and create a config file:

```bash
amx init
```

This scans for installed agents (`claude`, `codex`, `aider`, etc.), asks which ones to enable, and writes `.agentmx.yml` in your project root.

## First Steps

```bash
# Launch the interactive TUI
amx

# Run a single task
amx run "fix the memory leak in worker.ts"

# Run two agents side-by-side
amx run "write tests for auth.ts" --parallel claude-code,codex
```

See [Commands](commands.md) for the full reference.

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

## Next Steps

- [Configuration](configuration.md) — customize agents, routing, and UI
- [TUI Guide](tui.md) — learn keyboard shortcuts and dashboard features
- [Orchestration](orchestration.md) — pipelines, voting, and review workflows
