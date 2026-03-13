# Examples

Practical recipes for common workflows.

## Day-to-Day Usage

### Run a quick task

```bash
amx run "fix the null pointer in handleAuth()"
```

The router picks the best agent automatically based on your rules.

### Launch the TUI for interactive work

```bash
amx
```

Use number keys (`1-9`) to switch tabs, `Enter` to type, `Ctrl+Q` to quit.

## Comparing Agents

### Side-by-side comparison

```bash
amx run "explain what this repository does" --parallel claude-code,codex
```

### Benchmark a single task

```bash
amx bench "implement binary search in TypeScript" --agents claude-code,codex
```

### Run a benchmark suite

```bash
amx bench suite --suite algorithms --agents claude-code,codex --output report.md
```

## Multi-Agent Workflows

### Pipeline: research then implement

```bash
amx pipe \
  "claude-code: analyze the authentication flow and list all edge cases" \
  "codex: write tests covering every edge case found above"
```

### Pipeline: generate then refine

```bash
amx pipe \
  "codex: write a REST API for user management" \
  "claude-code: add comprehensive error handling and input validation"
```

### Consensus: pick the best answer

```bash
amx vote "design a caching strategy for the API layer" \
  --agents claude-code,codex,aider \
  --judge claude-code \
  --strategy best
```

### Consensus: merge the best parts

```bash
amx vote "draft a rollout plan for the new CLI release" \
  --agents claude-code,codex \
  --strategy merge
```

### Code review workflow

```bash
amx review "add retry logic to the webhook worker" \
  --coder codex \
  --reviewer claude-code \
  --tester aider
```

### Collaborative debugging

```bash
amx share "debug the production-only timeout issue" --agents claude-code,codex
```

Both agents work simultaneously and see each other's findings in real time.

## Routing Rules

### Config for automatic routing

```yaml
# .agentmx.yml
default_agent: claude-code

router:
  mode: rules
  rules:
    - match: "test|spec|coverage"
      agent: codex
      reason: "Codex is fast for test generation"
    - match: "refactor|clean|simplify"
      agent: claude-code
    - match: "docs|readme|changelog"
      agent: claude-code
```

```bash
amx run "write unit tests for the auth module"  # → codex
amx run "refactor the database layer"           # → claude-code
amx run "update the API documentation"          # → claude-code
amx run "optimize the build pipeline"           # → claude-code (default)
```

### Watch a task while iterating

```bash
amx watch "fix the flaky worker retry logic" --agent codex
```

As you edit files locally, AgentMX restarts the same task automatically.

## Budget Management

### Set per-agent limits

```bash
amx costs --set-budget claude-code --daily 5 --monthly 100
amx costs --set-budget codex --daily 3 --monthly 50
```

### Set global limits

```bash
amx costs --set-global-budget --daily 10 --weekly 50 --monthly 200
```

### Check current costs

```bash
amx costs
amx costs --budgets
```

## Session Management

### View past sessions

```bash
amx sessions
```

### Resume work

```bash
# Interactive picker
amx resume

# Direct resume
amx resume <session-id>
```

### Check usage analytics

```bash
# Last 7 days
amx stats --days 7

# Last 30 days, skip daily breakdown
amx stats --days 30 --no-daily
```

## Custom Agent Integration

### Wrap any CLI tool

```yaml
# .agentmx.yml
agents:
  my-linter:
    command: my-lint-tool
    args: ["--fix", "--format", "json"]
    env:
      CONFIG_PATH: "./lint.config.js"
    enabled: true
```

```bash
amx run "lint and fix all TypeScript files" --agent my-linter
```

### Use in a pipeline

```bash
amx pipe \
  "codex: implement the feature" \
  "my-linter: check and fix code style"
```
