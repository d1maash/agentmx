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

Run a task using one agent, a parallel set of agents, or an auto-selected orchestration strategy.

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

When `--agent auto` and `router.mode: auto` are used, AgentMX reads saved session history from `~/.agentmx/sessions` and scores enabled agents by:
- success rate on similar task types such as tests, UI, build, auth/security, refactors, and docs
- overall failure rate and build-failure history
- average cost when agent cost metadata is available
- available fallback agents

Based on those stats, `amx run "fix auth bug"` can choose:
- `single` — one historically strongest agent
- `parallel` — top agents in split view when scores are close or the task is complex
- `review-loop` — coder, reviewer, and tester roles for risky tasks
- `cheap-first` — the cheaper reliable agent first, then the strongest fallback if it exits non-zero

If there is not enough history yet, auto mode falls back to configured router rules and then `default_agent`.

## watch

```bash
amx watch <task> [options]
```

Watch the current working tree and rerun the same AI task when files change. This is useful for iterative loops where you edit code, let the agent react, and repeat.

| Option | Description |
|--------|-------------|
| `-a, --agent <name>` | Agent to use. Default is `auto` (router chooses). |
| `-p, --parallel <agents>` | Comma-separated agents to rerun together. |
| `-d, --debounce <ms>` | Wait time before restarting after file changes. Default is `500`. |

```bash
# Auto-route and keep watching
amx watch "fix the flaky auth test"

# Explicit agent
amx watch "tighten the API validation" --agent codex

# Restart multiple agents together
amx watch "refine the onboarding copy" --parallel claude-code,codex
```

`amx watch` ignores common noisy folders such as `.git`, `node_modules`, `dist`, and `coverage`.

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

Run a task on multiple agents with real-time context sharing. Each agent receives a structured shared state distilled from the others' output.

| Option | Description |
|--------|-------------|
| `-a, --agents <list>` | Comma-separated agents. Defaults to all enabled. |

Requires at least two agents. The shared state tracks repo map, found files, hypotheses, failing tests, decisions, rejected approaches, and final patch candidates.

```bash
amx share "debug the production-only timeout issue" --agents claude-code,codex
```

## solve

```bash
amx solve <task> [options]
```

Run an agent on a task and verify the resulting patch with objective checks: git diff, tests, lint, typecheck, and task compliance. Writes a `VerificationProof` artifact so you can prove the change is good — not just looks good.

| Option | Description |
|--------|-------------|
| `-a, --agent <name>` | Agent to use. Defaults to `claude-code` when available. |
| `--no-verify` | Skip verification — just run the agent. |
| `--verify-only` | Skip the agent run; verify the current working tree. |
| `--no-tests` | Don't run tests during verification. |
| `--no-lint` | Don't run lint during verification. |
| `--no-typecheck` | Don't run typecheck during verification. |
| `--proof-out <path>` | Where to write the proof. Default `.agentmx/last-proof.json` (+ `.md`). |
| `--patch-out <path>` | Where to write the patch. Default `.agentmx/last.patch`. |
| `--timeout <ms>` | Per-check timeout in milliseconds. |

Requires a git repository (it diffs `HEAD` vs working tree to capture the patch). Exits non-zero when verification fails.

```bash
# Run claude-code, verify, write proof + patch
amx solve "fix the failing auth integration test"

# Verify a patch you already applied by hand
amx solve "tighten validation in auth.ts" --verify-only

# Skip lint and typecheck, only run tests
amx solve "speed up the parser" --no-lint --no-typecheck
```

The proof reports a per-check verdict (`pass` / `fail` / `skip`), a 0–100 weighted score, the diff stats, and excerpts from any failing checks.

## pr-factory

```bash
amx pr-factory <issue> [options]
```

End-to-end pipeline that turns a GitHub issue into a reviewed pull request: fetch the issue → coder writes a patch → tester adds tests → commit and push → open a PR → reviewer posts a structured review → watch CI → optionally fix CI failures.

Requires the GitHub CLI (`gh`) installed and authenticated.

| Option | Description |
|--------|-------------|
| `--coder <agent>` | Agent that writes the implementation. |
| `--reviewer <agent>` | Agent that posts the PR review. |
| `--tester <agent>` | Agent that adds tests. Omit to use a third available agent. |
| `--no-tester` | Skip the test stage entirely. |
| `--base <branch>` | Base branch for the PR. Default `main`. |
| `--branch <name>` | Override the auto-generated branch name. |
| `--draft` | Open the PR as a draft. |
| `--no-ci` | Don't watch CI after the PR is opened. |
| `--ci-timeout <s>` | CI wait timeout in seconds. Default `900`. |
| `--ci-rounds <n>` | Maximum CI fix rounds. Default `1`. |

The issue argument can be an issue number (`123`), an `owner/repo#number`, or a full GitHub issue URL.

```bash
amx pr-factory 142 \
  --coder codex \
  --reviewer claude-code \
  --tester aider

amx pr-factory https://github.com/acme/api/issues/87 --draft --ci-rounds 2
```

When CI fails and `--ci-rounds` is greater than zero, the coder is rerun with the failing job logs as context.

## optimize

```bash
amx optimize <task> [options]
```

Cost-aware orchestration. Run cheap agents first; only escalate to expensive agents when verification fails. Reports the **cost of a successful PR**, including dollars burned on cheaper attempts that didn't pass.

| Option | Description |
|--------|-------------|
| `-t, --tiers <agents>` | Cheap-to-expensive agent list (comma-separated). Default `codex,claude-code`. |
| `--race` | Run all tiers in parallel; cancel siblings as soon as one verifies. |
| `--no-verify` | Skip verification — use raw exit codes for success detection. |
| `--tests-only` | Only run tests during verification (skip lint/typecheck). |
| `--timeout <seconds>` | Per-tier wall-clock timeout. |

Two modes:

- **Escalate** (default) — run tier 1, verify, only run tier 2 on failure. Lowest spend on average.
- **Race** (`--race`) — run all tiers concurrently, cancel the rest the moment one passes verification. Lowest wall-clock at the cost of more spend.

```bash
# Default cheap → expensive escalation
amx optimize "make the failing parser test pass"

# Custom tiers
amx optimize "ship the new tracing middleware" \
  --tiers codex,aider,claude-code

# Race mode for time-sensitive work
amx optimize "patch the production crash" --race --timeout 180
```

Each run prints a per-tier breakdown plus the total cost of producing the passing patch.

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

## dashboard

```bash
amx dashboard [options]
```

Launch a web-based analytics dashboard in the browser with interactive Chart.js charts.

| Option | Description |
|--------|-------------|
| `-p, --port <port>` | Port to listen on. Default is `3120`. |
| `--no-open` | Don't auto-open the browser. |

The dashboard shows:

- **Summary cards** — total sessions, success rate, total cost, total time, agents used
- **Daily Activity chart** — stacked bar of successes/errors per day (last 30 days)
- **Cost Trend chart** — line chart of daily cost over time
- **Tasks by Agent** — doughnut chart of task distribution
- **Success Rate by Agent** — horizontal bar, color-coded
- **Cost by Agent** — doughnut chart of cost breakdown
- **Agent Statistics table** — tasks, success/errors, rate, avg time, costs
- **Cost Summary table** — today/week/month/total per agent
- **Budget alerts** — warnings and exceeded limits at the top

Data auto-refreshes every 30 seconds. Press `Ctrl+C` in the terminal to stop the server.

```bash
amx dashboard
amx dashboard -p 8080
amx dashboard --no-open
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
