<div align="center">

# AgentMX

**One terminal. Every AI coding agent.**

Run Claude Code, Codex, Aider, Gemini, Copilot, Cursor, Goose — and any custom CLI — side-by-side in a single TUI.

[![npm version](https://img.shields.io/npm/v/agentmx?color=cb3837&label=npm)](https://www.npmjs.com/package/agentmx)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-43853d)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](CONTRIBUTING.md)

[Getting Started](docs/getting-started.md) · [Commands](docs/commands.md) · [Examples](docs/examples.md) · [Contributing](CONTRIBUTING.md)

</div>

---

## Why AgentMX?

Different agents are good at different things — Claude Code nails large refactors, Codex is fast on focused tasks, Aider is tightly coupled to git. But switching between terminals, configs, and sessions is painful.

AgentMX solves this with **one surface** to route, compare, chain, review, and resume work across all your agents.

## Install

```bash
npm install -g agentmx
```

Then install at least one agent:

```bash
npm install -g @anthropic-ai/claude-code   # Claude Code
npm install -g @openai/codex               # Codex CLI
pip install aider-chat                      # Aider
```

> **Requirements:** Node.js >= 20

## Quick Start

```bash
amx init                 # detect agents, create .agentmx.yml
amx                      # launch interactive TUI
amx run "fix the bug"    # run with auto-routing
amx watch "fix the bug"  # rerun when files change
```

## What Can It Do?

<table>
<tr>
<td width="50%" valign="top">

### Compare agents

```bash
amx run "write tests for auth.ts" \
  -p claude-code,codex
```

Run agents in parallel, compare output in split view.

</td>
<td width="50%" valign="top">

### Chain agents

```bash
amx pipe \
  "codex: find security issues" \
  "claude-code: fix them all"
```

Sequential handoff — output flows to the next step.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### Vote & consensus

```bash
amx vote "design caching strategy" \
  --agents claude-code,codex \
  --judge claude-code
```

Multiple agents answer, a judge picks the best or merges.

</td>
<td width="50%" valign="top">

### Code review

```bash
amx review "add pagination" \
  --coder codex \
  --reviewer claude-code \
  --tester aider
```

Three-stage pipeline: code → review → test.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### Shared context

```bash
amx share "debug timeout issue" \
  --agents claude-code,codex
```

Agents share a structured working state in real time.

</td>
<td width="50%" valign="top">

### Watch mode

```bash
amx watch "fix the flaky test" \
  --agent codex
```

Re-run the same AI task whenever project files change.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### Verified solve

```bash
amx solve "fix the failing auth test"
```

Runs an agent, then verifies the patch with diff, tests, lint, and typecheck — and writes a proof artifact.

</td>
<td width="50%" valign="top">

### PR factory

```bash
amx pr-factory 142 \
  --coder codex \
  --reviewer claude-code
```

Issue → code → tests → PR → review → CI, end-to-end, via the GitHub CLI.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### Cost optimizer

```bash
amx optimize "ship the parser fix" \
  --tiers codex,claude-code
```

Try the cheapest agent first, escalate only if verification fails. Reports cost-per-passing-PR.

</td>
<td width="50%" valign="top">

### Analytics & budgets

```bash
amx stats --days 14
amx costs
amx quality
```

Track usage, set budget alerts, score repo quality.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### Web dashboard

```bash
amx dashboard
```

Open a browser-based analytics dashboard with interactive Chart.js charts — costs, success rates, daily trends, and more.

</td>
<td width="50%" valign="top">

### CI mode

```bash
amx ci solve "fix the failing parser test" \
  --agent codex --max-cost 0.50 \
  --timeout 600 --report amx.json
```

Non-interactive wrappers (`ci run | solve | optimize | vote`) for GitHub Actions / Jenkins. Single JSON report, optional NDJSON event stream, and deterministic exit codes: `0` ok · `1` fail · `2` budget · `3` timeout · `4` usage.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### Worktree isolation

```bash
amx vote "implement retry" --isolate --apply-winner
amx optimize "ship the patch" --race --isolate
```

Each candidate / tier runs in its own `git worktree` so siblings never race for the working tree. The winner's diff is applied back automatically.

</td>
<td width="50%" valign="top">

### Hard-stop budgets

```bash
amx solve "refactor the cache layer" --max-cost 0.25
amx pr-factory 142 --max-cost 1.00
```

`--max-cost <usd>` kills the agent the moment its reported spend crosses the cap — not a post-hoc alert. Configurable globally via `budgets.hard_stop_per_run`.

</td>
</tr>
</table>

## Features at a Glance

```
 Tabbed TUI          Live streaming, scrolling, search, bookmarks, snippets, diff
 Task Routing        Auto-pick agents via regex rules or manual selection
 Parallel Runs       Side-by-side split view comparison
 Pipelines           Sequential agent handoff with context passing
 Voting              Multi-agent consensus with judge selection or merging
 Review Pipeline     Coder → Reviewer → Tester workflow
 Shared Context      Agents share structured working state
 Watch Mode          Re-run the same task automatically on file changes
 Verified Solve      Run an agent and prove the patch with tests + lint + typecheck
 PR Factory          Issue → code → tests → PR → review → CI in one command
 Cost Optimizer      Cheap-first escalation or race-to-pass to minimize spend
 Worktree Isolation  Per-agent git worktree for parallel runs; winner diff auto-applied
 Hard-Stop Budgets   --max-cost kills the agent the moment spend crosses the cap
 CI Mode             amx ci subcommands: JSON reports + deterministic exit codes
 Sessions            Save, list, delete, and resume previous work
 Analytics           Usage stats, per-agent costs, cost-per-pass, budget alerts
 Web Dashboard      Browser-based charts and tables via Chart.js
 Quality Scoring     Lint, test, and complexity analysis
 Benchmarks          Curated suites with Markdown reports
 Custom Agents       Wrap any CLI tool in one config block
```

## Supported Agents

| Agent | Command | Highlights |
|:------|:--------|:-----------|
| **Claude Code** | `claude` | Structured streaming, cost metadata, native resume |
| **Codex CLI** | `codex` | JSONL streaming, approval-aware execution |
| **Aider** | `aider` | PTY-based, git-oriented workflow |
| **Gemini CLI** | `gemini` | PTY adapter, `-p` task mode |
| **GitHub Copilot CLI** | `copilot` | PTY adapter, `-p` task mode |
| **Cursor Agent** | `cursor-agent` | PTY adapter, `-p` task mode |
| **Goose** | `goose` | PTY adapter, `run --text` task mode |
| **Custom** | *any CLI* | User-defined command, args, env in config |

## Keyboard Shortcuts

| Key | Action | | Key | Action |
|:----|:-------|---|:----|:-------|
| `1-9` | Switch tab | | `Ctrl+A` | Analytics dashboard |
| `←` `→` / `Tab` | Navigate tabs | | `Ctrl+F` | Search output |
| `Enter` | Input mode | | `Ctrl+B` | Add bookmark |
| `Esc` | Close / exit input | | `Ctrl+G` | Open bookmarks |
| `↑` `↓` | Scroll | | `Ctrl+S` | Snippets |
| `PgUp` `PgDn` | Page scroll | | `Ctrl+D` | Diff view |
| `Home` `End` | Top / bottom | | `Ctrl+N` | New agent |
| | | | `Ctrl+W` | Kill agent |
| | | | `Ctrl+Q` | Quit |

## Configuration

Create `.agentmx.yml` in your project root (or run `amx init`):

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

router:
  mode: rules
  rules:
    - match: "test|spec"
      agent: codex
    - match: "refactor|docs"
      agent: claude-code
```

See [Configuration docs](docs/configuration.md) for all options.

## Documentation

| | |
|:--|:--|
| **[Getting Started](docs/getting-started.md)** | Installation, setup, first steps |
| **[Commands](docs/commands.md)** | Full CLI reference |
| **[Configuration](docs/configuration.md)** | Config format, routing, custom agents |
| **[TUI Guide](docs/tui.md)** | Shortcuts, dashboard, sessions |
| **[Orchestration](docs/orchestration.md)** | Pipelines, voting, review, shared context |
| **[Analytics & Costs](docs/analytics.md)** | Usage stats, budgets, quality scoring |
| **[Architecture](docs/architecture.md)** | Project structure, internals |
| **[Examples](docs/examples.md)** | Practical usage recipes |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

[MIT](LICENSE)
