# Analytics, Costs & Quality

AgentMX tracks session history and provides analytics, cost management, and repository quality scoring.

## Analytics

View usage analytics from saved session history:

```bash
amx stats
amx stats --days 30
amx stats --days 7 --no-daily
```

### What's Tracked

- Total session count
- Success and error counts
- Total and average run duration
- Total and average cost (when cost metadata exists)
- Token totals (when adapters emit token usage)

### Breakdowns

- **Per-agent** — stats grouped by agent
- **Daily** — day-by-day breakdown
- **Weekly** — Monday-to-Sunday ranges

## Cost Tracking

View per-agent costs and manage budgets:

```bash
# View costs
amx costs

# View budget configuration
amx costs --budgets

# Set per-agent budget
amx costs --set-budget claude-code --daily 5 --weekly 20 --monthly 60 --total 200

# Set global budget
amx costs --set-global-budget --daily 10 --weekly 50 --monthly 200
```

### Budget Scopes

| Scope | Limits |
|-------|--------|
| Per-agent | daily, weekly, monthly, total |
| Global | daily, weekly, monthly |

### Budget Behavior

- **Warning** at 80% of a budget limit
- **Exceeded** at 100%
- A pre-start budget check runs before launching new agent sessions
- Budgets are currently informational — they surface alerts but don't hard-block execution

### Data Sources

Cost and token data depend on adapters emitting structured cost events. Claude Code provides these natively, making it the primary source for cost and token analytics today.

### Storage

| Data | Location |
|------|----------|
| Session history | `~/.agentmx/sessions/*.json` |
| Budget config | `~/.agentmx/budgets.json` |

## TUI Dashboard

Press `Ctrl+A` in the TUI to open the analytics dashboard:

| Tab | Key | Contents |
|-----|-----|----------|
| Overview | `1` | Session totals, success rate, per-agent stats, tokens |
| Costs | `2` | Per-agent cost breakdown and totals |
| History | `3` | Daily and weekly trends |

Active budget warnings appear as a banner at the top.

## Quality Scoring

Run lint, test, and complexity checks:

```bash
amx quality
amx quality --path ../service-api
```

### Checks

| Check | Tools Detected |
|-------|---------------|
| Linting | `biome`, `eslint` |
| Tests | `vitest`, `jest`, `pytest`, `go test`, `npm test` (fallback) |
| Complexity | Built-in line-count heuristic across common extensions |

### Scoring

The overall score is a weighted aggregate:

| Check | Weight |
|-------|--------|
| Tests | 4 |
| Linting | 3 |
| Complexity | 2 |

Higher weight means that check has more influence on the final score. Only available checks are included.
