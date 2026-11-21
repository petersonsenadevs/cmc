# Changelog

All notable changes to cmc (Claude Message Control). Versions follow [Semantic Versioning](https://semver.org/).

## 1.0.0 — 2026-11-21

First release.

### Hold and release
- Prompts that start with `;;` are held: the agent does not see them and is not interrupted.
- `/cmc:release`, `;;end` and `;;now` hand held messages over: all of them, or only some (`;;end 2`, `;;now 1 3`).
  Nothing is ever handed over in the middle of a turn: while the agent works, `;;now` waits for the end of the turn.
- Control words manage the queue without involving the agent: `;;list`, `;;edit`, `;;rm`, `;;clear`, `;;move`,
  `;;up`, `;;down`, `;;top`, `;;bottom`, `;;help`.
- The queue survives closing and resuming the session; inactive sessions are cleaned up after 30 days.
- A status line shows `✉ N held · ⚙ M agents`.

### Dispatch to a second agent
- `>> task` starts a second agent that forks the conversation; `>> --pack task` gives it a short summary instead.
- In a git repository it works in its own worktree; a clean worktree is removed when it ends, one with changes is kept.
- `;;agents`, `;;log`, `;;cancel` and `;;dispatch N` manage agents from the prompt.
- Its result comes back to the queue as a held message from that agent; with `--auto` it is handed over by itself
  at the end of a turn.

### Command line
- `cmc` does all of the above from another terminal, finding the session started in the current folder.
- `cmc config` and `cmc config init` show and create the settings file.

### Settings
- `config.json` in the plugin data directory: prefixes, how dispatched agents start and what they may do, retention.
  Wrong values fall back to their defaults and are reported; `bypassPermissions` is never accepted.

### Platform
- TypeScript run directly by Node 22.18 or newer; no build step and no runtime dependencies.
- Written for Windows, macOS and Linux; tested on Windows 11.
