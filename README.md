# cmc — Claude Message Control

A Claude Code plugin that lets you decide **when** your messages reach the agent: hold what you type while it
works, and release it when you want, without interrupting the turn.

> Status: work in progress. Phase 1 (hold and release) works; queue management, the external CLI and
> dispatching to a second agent are next.

## Requirements

- Claude Code 2.1.330 or newer
- Node.js 20 or newer (no npm dependencies, no build step)

## Try it from a checkout

```
claude --plugin-dir /path/to/this/repository
```

## Use

| You type | What happens |
|---|---|
| `;; also update the README` | The message is **held**. The agent does not see it and keeps working. You get the receipt `Held (1 queued)`. |
| `/cmc:release` | Every held message is handed to the agent, in delivery order. |
| `;;now` | Hands everything over **now**: the agent gets it at its next step, without waiting for the turn to end. If the agent is idle, it starts a turn with them. |
| `;;now 2` · `;;now 1 3` | Same, but only those messages. The rest stay held. |
| `;;end` | The held messages are handed over automatically when the current turn ends. One-shot. |
| `;;end 2` | Same, but only those messages. |

### Managing what is held

Control words are typed right after the prefix, with no space. The plugin answers them itself: the agent
never sees them, they cost no tokens, and they work while the agent is busy.

| You type | What happens |
|---|---|
| `;;list` | Shows the held messages in the order they will be delivered, with position, time and id. |
| `;;edit 2 new text` | Replaces the text of message 2. |
| `;;rm 2` · `;;rm 1 3` | Deletes messages. |
| `;;clear` | Deletes every held message. |
| `;;move 3 1` | Moves message 3 to position 1. |
| `;;up 2` · `;;down 2` | Moves message 2 one place. |
| `;;top 3` · `;;bottom 1` | Makes a message the first or the last to be delivered. |
| `;;help` | Lists the control words. |

The order you see in `;;list` is exactly the order of delivery. `/cmc:queue` shows the same list, but as a
slash command it goes through the agent, which then sees your held messages (still held); prefer `;;list`.

The same commands exist on the command line: `node bin/cmc.mjs list --session <id>` (see `cmc help`). From
there, `cmc release [N…]` hands messages to the agent at its next tool call, and `cmc release --end [N…]`
when its turn ends.

How sure each delivery is:

- **End of turn** (`;;end`, `/cmc:release`) is the dependable path: the text arrives as a new instruction.
- **Now** (`;;now`, `cmc release`) rides on the turn that is running. The agent receives the text between
  two steps and, in every test so far, acted on it; but it is the model that weighs text arriving
  mid-task, so treat it as best effort. Whatever happens, a message is handed over exactly once.

Things worth knowing:

- A message is held when it **starts** with `;;`. Anything else goes to the agent as usual.
- Put a space after the prefix to hold a message: `;; clear the cache` is held, `;;clear` empties the queue.
  Text that merely starts like a control word (`;;list the files`) is held as a message.
- Claude Code prints a three-line notice ("UserPromptSubmit operation blocked by hook…") for every held
  message. That notice is the receipt: the agent does not see it.
- While the agent is busy, Claude Code hands your message to the plugin when the tool that is running
  finishes, so the receipt shows up a moment after you press Enter.
- `/cmc:release` typed while the agent is busy takes effect when the turn ends, because Claude Code does not
  run slash commands in the middle of a turn. To get the same result without waiting at the keyboard, type
  `;;end`.
- Held messages belong to the session they were typed in and are stored on your machine, under the plugin
  data directory (`~/.claude/plugins/data/…/sessions/<session id>/queue.jsonl`).
- If the plugin itself fails, your prompt goes to the agent as if the plugin were not installed, and the
  error is written to `cmc.log` in the data directory. A message is never dropped silently.

## Development

```
npm test        # node --test
npm run lint    # syntax check of every module
claude plugin validate .
```

`node scripts/e2e.mjs` drives a real headless Claude Code session with this checkout loaded and types
messages into it while it works (it spends tokens, so it is not part of `npm test`). See
[docs/manual-test.md](docs/manual-test.md) for the scenarios and for the checks that need the interactive
terminal.

## Author

Peterson Sena (r3v3rs3)
