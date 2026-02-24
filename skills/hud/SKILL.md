---
name: "hud"
description: "Show or configure the A Team HUD (two-layer statusline)"
role: "display"
scope: ".a-team/**"
---

# HUD Skill

The A Team HUD uses a two-layer architecture:

1. **Layer 1 - Codex built-in statusLine**: Real-time TUI footer showing model, git branch, and context usage. Configured via `[tui] status_line` in `~/.codex/config.toml`. Zero code required.

2. **Layer 2 - `a-team hud` CLI command**: Shows A Team-specific orchestration state (ralph, ultrawork, autopilot, team, pipeline, ecomode, turns). Reads `.a-team/state/` files.

## Quick Commands

| Command | Description |
|---------|-------------|
| `a-team hud` | Show current HUD (modes, turns, activity) |
| `a-team hud --watch` | Live-updating display (polls every 1s) |
| `a-team hud --json` | Raw state output for scripting |
| `a-team hud --preset=minimal` | Minimal display |
| `a-team hud --preset=focused` | Default display |
| `a-team hud --preset=full` | All elements |

## Presets

### minimal
```
[A Team] ralph:3/10 | turns:42
```

### focused (default)
```
[A Team] ralph:3/10 | ultrawork | team:3 workers | turns:42 | last:5s ago
```

### full
```
[A Team] ralph:3/10 | ultrawork | autopilot:execution | team:3 workers | pipeline:exec | turns:42 | last:5s ago | total-turns:156
```

## Setup

`a-team setup` automatically configures both layers:
- Adds `[tui] status_line` to `~/.codex/config.toml` (Layer 1)
- Writes `.a-team/hud-config.json` with default preset (Layer 2)
- Default preset is `focused`; if HUD/statusline changes do not appear, restart Codex CLI once.

## Layer 1: Codex Built-in StatusLine

Configured in `~/.codex/config.toml`:
```toml
[tui]
status_line = ["model-with-reasoning", "git-branch", "context-remaining"]
```

Available built-in items (Codex CLI v0.101.0+):
`model-name`, `model-with-reasoning`, `current-dir`, `project-root`, `git-branch`, `context-remaining`, `context-used`, `five-hour-limit`, `weekly-limit`, `codex-version`, `context-window-size`, `used-tokens`, `total-input-tokens`, `total-output-tokens`, `session-id`

## Layer 2: A Team Orchestration HUD

The `a-team hud` command reads these state files:
- `.a-team/state/ralph-state.json` - Ralph loop iteration
- `.a-team/state/ultrawork-state.json` - Ultrawork mode
- `.a-team/state/autopilot-state.json` - Autopilot phase
- `.a-team/state/team-state.json` - Team workers
- `.a-team/state/pipeline-state.json` - Pipeline stage
- `.a-team/state/ecomode-state.json` - Ecomode active
- `.a-team/state/hud-state.json` - Last activity (from notify hook)
- `.a-team/metrics.json` - Turn counts

## Configuration

HUD config stored at `.a-team/hud-config.json`:
```json
{
  "preset": "focused"
}
```

## Color Coding

- **Green**: Normal/healthy
- **Yellow**: Warning (ralph >70% of max)
- **Red**: Critical (ralph >90% of max)

## Troubleshooting

If the TUI statusline is not showing:
1. Ensure Codex CLI v0.101.0+ is installed
2. Run `a-team setup` to configure `[tui]` section
3. Restart Codex CLI

If `a-team hud` shows "No active modes":
- This is expected when no workflows are running
- Start a workflow (ralph, autopilot, etc.) and check again
