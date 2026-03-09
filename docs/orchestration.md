# Orchestration Modes

AgentMX provides several ways to coordinate multiple agents beyond simple single-agent execution.

## Overview

| Mode | Command | Best For |
|------|---------|----------|
| Parallel comparison | `amx run --parallel` | Watching agents tackle the same task live |
| Sequential handoff | `amx pipe` | Stage-based collaboration |
| Consensus / judging | `amx vote` | Best-of-N or merged answers |
| Code review | `amx review` | Implementation + review + tests |
| Shared context | `amx share` | Collaborative investigation |
| Benchmarking | `amx bench` | Objective single-task comparison |
| Verified suites | `amx bench suite` | Repeatable benchmark runs with reports |

## Parallel Execution

Run multiple agents on the same task and compare their output in split view:

```bash
amx run "write unit tests for auth.ts" --parallel claude-code,codex
```

The TUI launches in split view with each agent working independently. Useful for quickly comparing approaches.

## Pipelines

Chain agents sequentially, where each step receives the previous step's output as context:

```bash
amx pipe \
  "codex: find all security issues in src/auth.ts" \
  "claude-code: fix the issues listed above"
```

Each step is written as `"agent: task"`. This is useful when different agents have complementary strengths.

### Pipeline Examples

```bash
# Research then implement
amx pipe \
  "claude-code: summarize this repository" \
  "codex: write onboarding docs based on that summary"

# Generate then refine
amx pipe \
  "codex: write a REST API for user management" \
  "claude-code: add error handling and input validation"
```

## Voting / Consensus

Multiple agents answer the same task, then a judge evaluates the results:

```bash
amx vote "implement retry logic for the webhook client" \
  --agents claude-code,codex,aider \
  --judge claude-code \
  --strategy best
```

### How It Works

1. **Phase 1** — All agents run the task in parallel, producing candidate responses
2. **Phase 2** — The judge agent receives all candidates and evaluates them

### Strategies

| Strategy | Judge Behavior |
|----------|---------------|
| `best` | Judge starts response with `WINNER: Candidate N` to pick the best |
| `merge` | Judge combines the strongest parts of all candidates |

### Requirements

- At least two agents
- Judge defaults to the first agent in the list if not specified

```bash
# Merge the best parts
amx vote "draft a launch checklist" \
  --agents claude-code,codex \
  --strategy merge
```

## Review Pipeline

A three-stage structured workflow:

1. **Coder** — writes the implementation
2. **Reviewer** — critiques the code
3. **Tester** — writes tests using the task and review feedback

```bash
amx review "add request tracing to the API" \
  --coder codex \
  --reviewer claude-code \
  --tester aider
```

### Default Role Assignment

If roles are omitted, AgentMX automatically assigns them:
- Coder defaults to `default_agent`
- Reviewer uses a different enabled agent when possible
- Tester uses another different enabled agent when possible
- If not enough agents are enabled, roles fall back to the default agent

## Shared Context

Multiple agents work on the same task while seeing each other's live output:

```bash
amx share "investigate the flaky CI failure" --agents claude-code,codex
```

### How It Works

- Each agent is connected to a shared context bus
- When one agent emits output, it's forwarded to others as context
- Long bursts are truncated before forwarding to reduce flooding
- Requires at least two agents

This mode is intentionally lightweight — it mirrors output as plain text rather than maintaining a formal shared state model. Best for collaborative investigation and debugging.

## Benchmarking

### Single Task

Compare agents on one task with timing and output metrics:

```bash
amx bench "implement binary search in TypeScript" --agents claude-code,codex
```

### Benchmark Suites

Run curated suites with automated verification and report generation:

```bash
# List available suites
amx bench suite --list

# Run a suite
amx bench suite --suite algorithms --agents claude-code,codex

# Custom output path
amx bench suite --suite practical --output bench-report.md
```

Suites include automated correctness checks and generate structured Markdown reports.
