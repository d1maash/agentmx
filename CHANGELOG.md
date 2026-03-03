# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- New built-in adapters: `gemini`, `copilot`, `cursor`, `goose`
- Task/interactive command mapping for new adapters:
  - `gemini -p <task>` / `gemini`
  - `copilot -p <task>` / `copilot`
  - `cursor-agent -p <task>` / `cursor-agent`
  - `goose run --text <task>` / `goose session`
- Config defaults and `.agentmx.example.yml` entries for Gemini CLI, GitHub Copilot CLI, Cursor Agent, and Goose (disabled by default)

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
