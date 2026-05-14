# Orchestration Modes

AgentMX provides several ways to coordinate multiple agents beyond simple single-agent execution.

## Overview

| Mode | Command | Best For |
|------|---------|----------|
| Parallel comparison | `amx run --parallel` | Watching agents tackle the same task live |
| Iterative watch | `amx watch` | Re-running the same task as you edit files |
| Sequential handoff | `amx pipe` | Stage-based collaboration |
| Consensus / judging | `amx vote` | Best-of-N or merged answers |
| Code review | `amx review` | Implementation + review + tests |
| Shared context | `amx share` | Collaborative investigation |
| Verified solve | `amx solve` | Run-then-verify with a proof artifact |
| PR factory | `amx pr-factory` | Issue → code → tests → PR → review → CI |
| Cost optimizer | `amx optimize` | Cheap-first escalation or race-to-pass |
| Benchmarking | `amx bench` | Objective single-task comparison |
| Verified suites | `amx bench suite` | Repeatable benchmark runs with reports |

## Auto-Routing From History

With `router.mode: auto`, `amx run <task>` scores enabled agents from saved session history before it starts work. It classifies the task, compares similar past sessions, and factors in overall success, build failures, and average cost.

Depending on the score and task risk, auto-routing can select:

| Strategy | Behavior |
|----------|----------|
| `single` | Run the strongest historical agent |
| `parallel` | Launch the top two or three agents in split view |
| `review-loop` | Run the structured coder → reviewer → tester pipeline |
| `cheap-first` | Try the cheapest reliable agent, then retry with the strongest fallback if needed |

Examples:

```bash
amx run "fix auth bug"
amx run "cheap update docs"
amx run "repair failing vitest suite"
```

If there are fewer than a few usable historical sessions, AgentMX falls back to router rules and then `default_agent`.

## Parallel Execution

Run multiple agents on the same task and compare their output in split view:

```bash
amx run "write unit tests for auth.ts" --parallel claude-code,codex
```

The TUI launches in split view with each agent working independently. Useful for quickly comparing approaches.

## Watch Mode

Re-run the same task whenever files in the current workspace change:

```bash
amx watch "fix the flaky CI test" --agent codex
```

This mode is closer to `nodemon`: AgentMX runs once immediately, keeps watching the repo, and restarts the task after a short debounce window when files change.

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
- Agent output is distilled into a structured shared state
- The shared state tracks repo map, found files, hypotheses, failing tests, decisions, rejected approaches, and final patch candidates
- Agents receive compact state snapshots when meaningful shared state changes
- Requires at least two agents

This mode keeps a common working memory instead of mirroring the full transcript. Best for collaborative investigation and debugging where agents should converge on the same facts and decisions.

## Verified Solve

`amx solve` couples an agent run with an objective verification stage so you can prove a patch is good — not just that it looks good.

```bash
amx solve "fix the failing auth integration test"
```

After the agent finishes, AgentMX runs a `VerificationProof` over the working tree:

| Check | Source |
|-------|--------|
| Diff | `git diff HEAD` — files changed, +/- lines |
| Tests | First detected runner (vitest, jest, pytest, go test, npm test) |
| Lint | `biome` or `eslint` if present |
| Typecheck | `tsc --noEmit` for TypeScript projects |
| Compliance | Heuristic check that the diff matches the task description |

Each check reports a `pass` / `fail` / `skip` verdict and a 0–100 weighted score. The proof is written to `.agentmx/last-proof.json` (and a human-readable `.md`), and the captured patch goes to `.agentmx/last.patch`.

Use `--verify-only` to score a working tree you already produced by hand, or pass `--no-tests`, `--no-lint`, `--no-typecheck` to scope the verification.

## PR Factory

`amx pr-factory` automates the full GitHub workflow from a tracked issue to a reviewed pull request.

```bash
amx pr-factory 142 \
  --coder codex \
  --reviewer claude-code \
  --tester aider
```

Stages run in order, streaming output and per-stage timing:

1. **Issue** — fetch the issue body via `gh`
2. **Coder** — agent writes the implementation
3. **Tester** — second agent adds tests (skip with `--no-tester`)
4. **Git** — commit and push to a generated branch
5. **PR** — open the pull request (`--draft` supported)
6. **Reviewer** — third agent posts a structured review on the PR
7. **CI** — watch checks; if they fail and `--ci-rounds` allows, rerun the coder with failing logs as context

Requires `gh` installed and authenticated. Multi-agent role assignment falls back to `default_agent` when fewer than three agents are enabled.

## Cost Optimizer

`amx optimize` minimizes the cost of producing a verified patch. Cheap agents go first; expensive agents only run if cheap ones fail verification.

```bash
amx optimize "patch the failing parser test" \
  --tiers codex,aider,claude-code
```

| Strategy | When to use |
|----------|-------------|
| `escalate` (default) | Sequential cheap → expensive; lowest spend on average |
| `--race` | Parallel run; cancel siblings on first verified pass; lowest wall-clock |

The summary reports the **cost of a successful PR** — including any spend on cheaper tiers that failed before the winning attempt — so you can compare strategies on dollars-per-passed-task rather than on raw spend.

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
