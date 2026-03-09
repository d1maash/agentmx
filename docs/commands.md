# Commands

All commands are available via `amx` (short alias for `agentmx`).

## interactive

```bash
amx
amx interactive
```

Launch the interactive TUI. This is the default command when you run `amx` without arguments.

Use it for:
- Long-running interactive sessions
- Tabbed switching between agents
- Split-view comparisons
- Search, bookmarks, snippets, diff view
- The built-in dashboard (`Ctrl+A`)

## run

```bash
amx run <task> [options]
```

Run a single task using one agent or a parallel set of agents.

| Option | Description |
|--------|-------------|
| `-a, --agent <name>` | Agent to use. Default is `auto` (router chooses). |
| `-p, --parallel <agents>` | Comma-separated agents for side-by-side split view. |

```bash
# Auto-route
amx run "refactor the auth module"

# Explicit agent
amx run "generate API docs" --agent codex

# Parallel comparison
amx run "review this patch" --parallel claude-code,codex,aider
```

When `--parallel` is used, AgentMX launches the TUI in split view with each agent running the same task.

## bench

```bash
amx bench <task> [options]
```

Benchmark one task across multiple agents. Compares execution time, exit code, output size, and cost metadata.

| Option | Description |
|--------|-------------|
| `-a, --agents <list>` | Comma-separated agent names. Defaults to all enabled agents. |

```bash
amx bench "write a fibonacci function in Rust"
amx bench "fix the login bug" --agents claude-code,codex
```

## bench suite

```bash
amx bench suite [options]
```

Run curated benchmark suites with automated verification and Markdown report generation.

| Option | Description |
|--------|-------------|
| `-s, --suite <id>` | Suite to run (`algorithms`, `practical`). |
| `-a, --agents <list>` | Comma-separated agents. |
| `-o, --output <path>` | Path for the Markdown report. |
| `--list` | List available suites and exit. |
| `--keep-workspaces` | Keep temp workspaces after the run. |

```bash
amx bench suite --list
amx bench suite --suite algorithms --agents claude-code,codex
amx bench suite --suite practical --output bench-report.md
```

If no output path is given, a report like `bench-report-<timestamp>.md` is written automatically.

## pipe

```bash
amx pipe <steps...>
```

Run agents in sequence. Each step is `"agent: task"`. Output from earlier steps becomes context for later steps.

```bash
amx pipe \
  "codex: find all security issues in src/auth.ts" \
  "claude-code: fix the issues listed above"

amx pipe \
  "claude-code: summarize this repository" \
  "codex: write onboarding docs based on that summary"
```

## vote

```bash
amx vote <task> [options]
```

Run the same task on multiple agents, then ask a judge to evaluate results.

| Option | Description |
|--------|-------------|
| `-a, --agents <list>` | Comma-separated agents. Defaults to all enabled. |
| `-j, --judge <agent>` | Judge agent. Defaults to first in the list. |
| `-s, --strategy <type>` | `best` or `merge`. Default is `best`. |

**How it works:**
1. Phase 1 collects candidate responses from all agents
2. Phase 2 runs the judge with the full set of candidates
3. `best` — judge starts response with `WINNER: Candidate N`
4. `merge` — judge combines the strongest parts of all candidates

Requires at least two agents.

```bash
amx vote "implement retry logic for the webhook client" \
  --agents claude-code,codex,aider \
  --judge claude-code \
  --strategy best
```

## review

```bash
amx review <task> [options]
```

Three-stage review pipeline:
1. **Coder** writes the implementation
2. **Reviewer** critiques the result
3. **Tester** writes tests using the task and review feedback

| Option | Description |
|--------|-------------|
| `--coder <agent>` | Agent for implementation. |
| `--reviewer <agent>` | Agent for code review. |
| `--tester <agent>` | Agent for writing tests. |

If roles are omitted, AgentMX uses the default agent and picks different enabled agents for each role when possible.

```bash
amx review "add request tracing to the API" \
  --coder codex \
  --reviewer claude-code \
  --tester aider
```

## share

```bash
amx share <task> [options]
```

Run a task on multiple agents with real-time context sharing. Each agent sees the others' output as it comes in.

| Option | Description |
|--------|-------------|
| `-a, --agents <list>` | Comma-separated agents. Defaults to all enabled. |

Requires at least two agents. Long bursts are truncated before forwarding.

```bash
amx share "debug the production-only timeout issue" --agents claude-code,codex
```

## sessions

```bash
amx sessions [options]
```

List, delete, or clear saved sessions.

| Option | Description |
|--------|-------------|
| `--delete <id>` | Delete a single session. |
| `--clear` | Delete all sessions. |

```bash
amx sessions
amx sessions --delete 0f4a4d6d-...
amx sessions --clear
```

## resume

```bash
amx resume [session-id]
```

Resume a previously saved session.

- With a session ID: resumes directly
- Without: opens an interactive picker
- Claude Code sessions use native resume when available
- Other agents restart in interactive mode with the previous transcript as context

```bash
amx resume
amx resume <session-id>
```

## stats

```bash
amx stats [options]
```

Analytics dashboard from saved session history.

| Option | Description |
|--------|-------------|
| `-d, --days <n>` | Limit to last `n` days. |
| `--no-daily` | Hide daily breakdown. |
| `--no-weekly` | Hide weekly breakdown. |

Shows: total sessions, success rate, costs, runtime, per-agent stats, daily/weekly trends.

```bash
amx stats
amx stats --days 30
amx stats --days 7 --no-daily
```

## costs

```bash
amx costs [options]
```

Per-agent costs, budget alerts, and budget configuration.

| Option | Description |
|--------|-------------|
| `--set-budget <agent>` | Set per-agent budget limits. |
| `--set-global-budget` | Set global budget limits. |
| `--daily <amount>` | Daily USD limit. |
| `--weekly <amount>` | Weekly USD limit. |
| `--monthly <amount>` | Monthly USD limit. |
| `--total <amount>` | Total cumulative USD limit. |
| `--budgets` | Show current budget config only. |

```bash
amx costs
amx costs --budgets
amx costs --set-budget claude-code --daily 5 --weekly 20 --monthly 60
amx costs --set-global-budget --daily 10 --weekly 50
```

## quality

```bash
amx quality [options]
```

Repository quality scan: linting, tests, and complexity.

| Option | Description |
|--------|-------------|
| `-p, --path <dir>` | Directory to analyze. Defaults to cwd. |

Detects: `biome`/`eslint` for linting, `vitest`/`jest`/`pytest`/`go test`/`npm test` for tests, built-in line-count for complexity.

Weighted scoring: tests (4), linting (3), complexity (2).

```bash
amx quality
amx quality --path ../service-api
```

## config

```bash
amx config
```

Print the fully resolved configuration as JSON. Useful for debugging which config file was loaded and what values were merged.

## init

```bash
amx init
```

Interactive setup wizard. Detects installed agents, asks which to enable, and writes `.agentmx.yml`.
