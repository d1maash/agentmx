# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.11.0] - 2026-05-14

### Added

- **`amx ci` non-interactive command tree** for use in GitHub Actions / Jenkins / etc.
  Subcommands `ci run`, `ci solve`, `ci optimize`, `ci vote` emit a single JSON
  report (stdout or `--report`), optional NDJSON event stream via
  `--json-events`, and exit with deterministic codes: `0` ok, `1` failure,
  `2` budget hit, `3` timeout, `4` usage error.
- **Worktree isolation** for parallel agent runs. `vote --isolate`,
  `optimize --isolate`, and `ci optimize --isolate` allocate a fresh git
  worktree per candidate/tier so siblings never race for the working tree.
  The winning candidate's diff is applied back into the host tree (opt-in
  via `--apply-winner` on `vote`). Config: `parallel.isolate`,
  `parallel.keep_worktrees`. New helper module `core/worktree.ts`.
- **Hard-stop budgets**: `--max-cost <usd>` on `run`, `solve`, `vote`,
  `optimize`, `pr-factory`, and every `amx ci` subcommand. The agent is
  killed the moment its reported total spend crosses the cap. Config:
  `budgets.hard_stop_per_run`. `ProcessManager` now emits
  `budget:hardstop` and exposes `wasHardStopped(sessionId)`.

## [0.10.0] - 2026-04-29

### Added

- `watch` command to rerun an AI task automatically when workspace files change
- New built-in adapters: `gemini`, `copilot`, `cursor`, `goose`
- New CLI commands:
  - `vote` for multi-agent consensus with a judge agent
  - `review` for coder -> reviewer -> tester pipelines
  - `share` for multi-agent live context sharing
  - `stats` for analytics summaries from saved sessions
  - `costs` for cost reports and budget configuration
  - `quality` for lint, test, and complexity scoring
- Task/interactive command mapping for new adapters:
  - `gemini -p <task>` / `gemini`
  - `copilot -p <task>` / `copilot`
  - `cursor-agent -p <task>` / `cursor-agent`
  - `goose run --text <task>` / `goose session`
- Config defaults and `.agentmx.example.yml` entries for Gemini CLI, GitHub Copilot CLI, Cursor Agent, and Goose (disabled by default)
- Saved-session analytics and cost aggregation based on persisted session history
- Budget configuration and alerting stored in `~/.agentmx/budgets.json`
- TUI analytics dashboard with overview, costs, and history tabs

### Changed

- TUI keyboard shortcuts and status bar now expose the dashboard on `Ctrl+A`
- Session startup now performs budget checks before launching new agent work
- Documentation refreshed to cover new orchestration modes, analytics, budgets, quality scoring, sessions, and benchmark suites

## [0.1.0] - 2026-03-01

### Added

- Interactive TUI with tabbed agent sessions
- Claude Code adapter with structured stream-json output and streaming support
- Codex CLI adapter with JSONL parsing and approval flow
- Aider adapter with PTY-based git integration
- Custom agent support — wrap any CLI tool
- Task routing with manual, rules-based, and auto modes
- Pipeline execution — chain agents sequentially with context passing
- Parallel execution with split view (vertical/horizontal)
- Keyboard shortcuts for tab switching, scrolling, input, agent management
- Configuration via `.agentmx.yml` (cosmiconfig)
- CLI commands: `interactive`, `run`, `pipe`, `config`
- Short alias: `amx`
