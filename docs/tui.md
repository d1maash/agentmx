# TUI Guide

The interactive TUI is the main way to use AgentMX. Launch it with:

```bash
amx
amx interactive
```

## Keyboard Shortcuts

### Navigation

| Key | Action |
|-----|--------|
| `1-9` | Jump to agent tab by index |
| `Left / Right` | Previous / next tab |
| `Tab` | Cycle tabs |
| `Up / Down` | Scroll output |
| `PgUp / PgDn` | Page scroll |
| `Home / End` | Jump to top / bottom |

### Input

| Key | Action |
|-----|--------|
| `Enter` | Enter input mode |
| `Esc` | Exit input mode or close overlays |

### Features

| Key | Action |
|-----|--------|
| `Ctrl+A` | Open analytics dashboard |
| `Ctrl+F` | Search current output |
| `Ctrl+B` | Add bookmark at current position |
| `Ctrl+G` | Open bookmark list |
| `Ctrl+S` | Open snippet picker |
| `Ctrl+D` | Open diff view |

### Session Management

| Key | Action |
|-----|--------|
| `Ctrl+N` | Create a new agent session |
| `Ctrl+W` | Kill the current agent |
| `Ctrl+Q` | Quit |

## Dashboard

Press `Ctrl+A` to open the built-in analytics dashboard. Switch between tabs with number keys:

| Key | Tab | Contents |
|-----|-----|----------|
| `1` | Overview | Session totals, success rate, per-agent stats, token usage |
| `2` | Costs | Per-agent cost breakdown and totals |
| `3` | History | Daily and weekly trends |

Budget warnings and exceeded limits appear as a banner when active.

Press `Esc` to close the dashboard and return to normal view.

## Search

Press `Ctrl+F` to open the search overlay. Type to filter the current agent's output. Press `Esc` to close.

## Bookmarks

- `Ctrl+B` — bookmark the current scroll position
- `Ctrl+G` — open the bookmark list and jump to a saved position

Bookmarks are per-session and help you navigate long output.

## Snippets

Press `Ctrl+S` to open the snippet picker. Snippets let you quickly insert common prompts or commands.

## Diff View

Press `Ctrl+D` to compare output from two agents side-by-side in a diff format.

## Saved Sessions

Finished sessions are automatically persisted under:

```
~/.agentmx/sessions/*.json
```

Each session stores:
- Session ID and agent name
- Original task
- Timestamps and exit code
- Working directory
- Serialized output buffer

This data powers `amx sessions`, `amx resume`, `amx stats`, `amx costs`, and the TUI dashboard.

### Managing Sessions

```bash
# List all sessions
amx sessions

# Resume interactively
amx resume

# Resume a specific session
amx resume <session-id>

# Delete one session
amx sessions --delete <session-id>

# Clear all sessions
amx sessions --clear
```

Claude Code sessions resume natively when a Claude session ID is available. Other agents restart in interactive mode with the previous transcript as context.
