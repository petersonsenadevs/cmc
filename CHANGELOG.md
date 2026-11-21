# Changelog

All notable changes to cmc (Claude Message Control). Versions follow [Semantic Versioning](https://semver.org/).

## 1.1.0 — 2026-11-21

### The cmc hub
- `/cmc` opens a panel beside the chat, drawn by Claude Code's own plugin engine and used with the mouse or the keyboard:
  Messages, Subagents, Activity and Settings, each with a line on what it is. It opens by itself when you hold a message
  or a subagent starts (`panelAutoOpen`), and `/cmc` closes it.
- Messages: a click on a message shows its actions (Send now, To subagent, Edit in the row, ↑, ↓, Delete); a box holds a
  message without `;;`; Send all and Clear.
- Send now: at once with the agent idle; while it works, into the prompt box for Ctrl+Enter, Claude Code's own send-now.
- Subagents: a New subagent task box; each subagent with its state, time, context, model and effort; its conversation as
  a chat, with a box to write to it, Send result to main and Stop.
- Settings: every mode explained and switched with one click; model and effort selectors.
- Header with the mark, "Claude Message Control" and "by r3v3rs3" (a link); version and repository at the bottom right.

### Holding
- What you hold while the agent works reaches it **when its turn ends**, with no command (`sendAtEnd`, on by default;
  `false` keeps the old behaviour).
- A held message leaves the prompt box at once, with a one-line notice instead of three.
- `/held` (a menu in Claude Code's own dialog) and `/send [N…]`.
- A line at the end of each turn says what is still held.
- Esc no longer leaves cmc thinking the agent is working.
- `holdTarget: "subagent"`: what you type after `;;` starts a subagent instead.

### Subagents
- Their session stays open after they answer (`dispatch.keepOpenMinutes`, 10 by default): write to them with
  `;;tell <id> <text>`, `cmc tell` or the hub; each answer comes back. A closed session is resumed.
- Model and effort: `dispatch.model` and `dispatch.effort` (`inherit` by default), or per task with `--model` and
  `--effort`.
- `dispatch.ignoreChanges`: paths other tools write into a subagent's worktree, not counted as its work.

### Fixes
- A message never leaves the queue unless its delivery was accepted.
- Stopping a subagent while it saved an answer could leave it marked as waiting.
- Stop delivers even while another plugin's Stop hook continues the turn.

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
