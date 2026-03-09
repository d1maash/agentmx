# Architecture

## Project Structure

```
src/
  adapters/          # Agent adapters and factory
  bench/             # Benchmark suites, orchestrator, verification, reports
  cli/
    commands/        # All CLI command implementations
  config/            # Schema (Zod), cosmiconfig loader, defaults
  core/              # Runtime: process manager, router, pipeline,
                     # session store, analytics, cost tracker,
                     # voting, review pipeline, context bus
  tui/
    components/      # TUI views (tabs, status bar, dashboard, diff, etc.)
    hooks/           # Keyboard handling, agent lifecycle
    utils/           # Bookmarks, snippets, terminal helpers
```

## Core Runtime

| Component | Responsibility |
|-----------|---------------|
| **ProcessManager** | Starts agent processes, tracks lifecycle, saves finished sessions, budget checks |
| **SessionStore** | Persists sessions under `~/.agentmx/sessions` |
| **Task Router** | Chooses an agent for `amx run` based on routing rules |
| **Pipeline Engine** | Passes output between steps in `amx pipe` |
| **ContextBus** | Mirrors live output between agents in `amx share` |
| **VotingSession** | Coordinates parallel candidates + judge in `amx vote` |
| **ReviewPipeline** | Coordinates coder → reviewer → tester in `amx review` |
| **Analytics** | Aggregates session history into summaries |
| **CostTracker** | Computes cost totals and budget alerts |
| **QualityScorer** | Runs lint, test, and complexity checks |

## Adapters

Each supported agent has an adapter in `src/adapters/` that implements the `AgentAdapter` interface.

| Adapter | File | Integration |
|---------|------|-------------|
| Claude Code | `claude-code.ts` | Structured stream-json with cost events |
| Codex CLI | `codex.ts` | JSONL streaming with approval flow |
| Aider | `aider.ts` | PTY-based with git integration |
| Gemini CLI | `gemini.ts` | PTY adapter |
| Copilot CLI | `copilot.ts` | PTY adapter |
| Cursor Agent | `cursor.ts` | PTY adapter |
| Goose | `goose.ts` | PTY adapter |
| Custom | `custom.ts` | Configurable PTY wrapper |

The `factory.ts` file creates adapter instances based on config. PTY-based adapters share utilities from `pty-helpers.ts`.

## TUI

Built with React 18 + [Ink](https://github.com/vadimdemedes/ink) for terminal rendering.

Key components:
- **AgentTabs** — tab bar for switching between agents
- **AgentView** — scrollable output display per agent
- **InputBar** — user input with mode switching
- **StatusBar** — status display at bottom
- **SplitView** — side-by-side layout for parallel runs
- **DashboardView** — analytics dashboard with three tabs
- **SearchOverlay** — full-text search in agent output
- **DiffView** — diff comparison between agents
- **BenchView / SuiteView** — benchmark progress and results

## Data Flow

```
User input
  → CLI (Commander) parses command
  → Command handler creates ProcessManager/Pipeline/VotingSession/etc.
  → ProcessManager spawns agent via adapter
  → Adapter wraps PTY or structured stream
  → Output streamed to TUI components
  → Session saved to SessionStore on completion
  → Analytics/CostTracker aggregate from stored sessions
```

## Technology Stack

| Category | Libraries |
|----------|-----------|
| CLI | Commander 12 |
| Config | cosmiconfig 9, Zod 3, YAML 2 |
| TUI | React 18, Ink 5 |
| Process | node-pty 1, tree-kill |
| Logging | Pino 9 |
| Build | tsup, TypeScript 5 (strict) |
| Test | Vitest 2, ink-testing-library 4 |
