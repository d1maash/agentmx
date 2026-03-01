# Contributing to AgentMX

Thanks for your interest in contributing to AgentMX! This guide will help you get started.

## Development Setup

1. **Clone the repo**

```bash
git clone https://github.com/YOUR_USERNAME/agentmx.git
cd agentmx
```

2. **Install dependencies**

```bash
pnpm install
```

3. **Build**

```bash
pnpm run build
```

4. **Run in development mode** (auto-rebuild on changes)

```bash
pnpm run dev
```

5. **Run locally**

```bash
node dist/cli/index.js
```

## Project Structure

```
src/
  cli/              # CLI entry point and commands
    commands/        # run, pipe, interactive commands
  adapters/          # Agent adapters (claude-code, codex, aider, custom)
  core/              # Process manager, router, pipeline, session
  config/            # Config schema, loader, defaults
  tui/               # Terminal UI (React/Ink)
    components/      # AgentTabs, AgentView, InputBar, StatusBar, SplitView
    hooks/           # useAgents, useKeyboard
    utils/           # Terminal utilities
```

## Adding a New Agent Adapter

1. Create a new file in `src/adapters/` (e.g., `my-agent.ts`)
2. Implement the `AgentAdapter` interface from `src/adapters/types.ts`
3. Register it in `src/adapters/factory.ts`
4. Add default config in `src/config/defaults.ts`

## Running Tests

```bash
pnpm test
```

## Type Checking

```bash
pnpm run lint
```

## Guidelines

- **Keep it simple** — avoid over-engineering
- **TypeScript strict mode** — no `any` types, handle all cases
- **ESM only** — use `.js` extensions in imports
- **Test your changes** — especially for adapter and core logic
- **One PR per feature/fix** — keep pull requests focused

## Commit Messages

Use clear, descriptive commit messages:

```
add codex adapter with JSONL streaming
fix scroll offset calculation in AgentView
update config schema to support custom env vars
```

## Reporting Issues

When reporting a bug, please include:

- Node.js version (`node --version`)
- OS and architecture
- Steps to reproduce
- Expected vs actual behavior
- Debug log if relevant (`/tmp/agentmx-debug.log`)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
