# Configuration

## Config File

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

# Allocate a git worktree per agent in vote/optimize/run -p flows so siblings
# never race for the working tree. Off by default; opt in here or per-command.
parallel:
  isolate: false
  keep_worktrees: false

# Hard cost guard. When an agent's reported total spend crosses this cap, the
# process is killed and the run exits with code 2 in `amx ci`. Override on the
# CLI with --max-cost.
budgets:
  hard_stop_per_run: 1.00
```

### Alternative Formats

AgentMX uses [cosmiconfig](https://github.com/cosmiconfig/cosmiconfig), so you can also use:

- `.agentmxrc`
- `.agentmxrc.json`
- `.agentmxrc.yaml`
- `agentmx` field inside `package.json`

Run `amx init` to generate a config file interactively.

## Routing

When `amx run` is called without an explicit agent, the router picks one:

| Mode | Behavior |
|------|----------|
| `manual` | Always use `default_agent`. |
| `rules` | Match regex rules in order, fall back to `default_agent`. |
| `auto` | Rules-first, with room for future classifier-driven routing. |

### Example

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
amx run "write unit tests for auth.ts"   # → codex
amx run "refactor the data layer"        # → claude-code
amx run "optimize the build pipeline"    # → claude-code (default)
```

Rules are matched in order. The first matching rule wins. If no rule matches, `default_agent` is used.

### Regex Tips

- Rules use JavaScript regex syntax
- Patterns are case-sensitive by default
- Use `(?i)` prefix for case-insensitive: `"(?i)test|spec"`
- Support for multiple languages: `"тест|test|spec"` (Russian + English)

## Custom Agents

Any CLI tool can be wrapped as an agent:

```yaml
agents:
  my-agent:
    command: my-agent-cli
    args: ["--flag", "--output", "json"]
    env:
      API_KEY: "sk-..."
      VERBOSE: "true"
    enabled: true
```

Then use it like any built-in agent:

```bash
amx run "fix the bug" --agent my-agent
```

### Agent Config Fields

| Field | Type | Description |
|-------|------|-------------|
| `command` | string | The CLI command to execute |
| `args` | string[] | Arguments passed to the command |
| `env` | object | Environment variables for the process |
| `enabled` | boolean | Whether the agent appears in TUI and routing |

## UI Settings

```yaml
ui:
  theme: dark          # dark | light (reserved for future use)
  split_view: vertical # vertical | horizontal
```

`split_view` controls the layout when running parallel agents with `amx run --parallel` or `amx share`.

## Checking Resolved Config

```bash
amx config
```

Prints the fully resolved configuration as JSON, useful for debugging which file was loaded and what values were merged.
