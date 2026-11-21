# cmc — Claude Message Control

A Claude Code plugin that lets you decide **when** your messages reach the agent: hold what you type while it
works, and release it when you want, without interrupting the turn.

> Status: work in progress. Phase 1 (hold and release) works; queue management, the external CLI and
> dispatching to a second agent are next.

## Requirements

- Claude Code 2.1.330 or newer
- Node.js 22.18 or newer. The plugin is written in TypeScript and Node runs the `.ts` files directly: there is
  no build step and nothing to install besides the plugin folder (no runtime npm dependencies)

## Install

This repository is a Claude Code marketplace (`r3v3rs3`) that holds the plugin in `plugins/cmc`. Add the
marketplace, then install the plugin from it:

```
/plugin marketplace add /path/to/this/repository
/plugin install cmc@r3v3rs3
```

The same from a terminal: `claude plugin marketplace add /path/to/this/repository` and
`claude plugin install cmc@r3v3rs3`. Only `plugins/cmc` is installed; the rest of the repository (tests,
development notes) stays out.

To try it from a checkout without installing: `claude --plugin-dir /path/to/this/repository/plugins/cmc`.

## Use

| You type | What happens |
|---|---|
| `;; also update the README` | The message is **held**. The agent does not see it and keeps working. You get the receipt `Held (1 queued)`. |
| `/cmc:release` | Every held message is handed to the agent, in delivery order. |
| `;;now` | Hands everything over **now**. If the agent is idle, it starts a turn with them. If it is busy, they arrive at its next step, but the model may set them aside (see below). |
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

### From another terminal

Open a second terminal **in the folder where the Claude Code session was started** (a subfolder works too)
and use the `cmc` command line. Nothing you do there shows up in the session until you release it.

```
node /path/to/this/repository/plugins/cmc/bin/cmc.ts hold also update the README
node /path/to/this/repository/plugins/cmc/bin/cmc.ts list
```

`npm link` in this repository puts `cmc` on your PATH, so that becomes `cmc hold …`, `cmc list`, and so on.

| Command | What it does |
|---|---|
| `cmc hold <text>` | Holds a message, like `;; text` in the session. |
| `cmc list` · `edit` · `rm` · `clear` · `move` · `up` · `down` · `top` · `bottom` | The same as the control words. |
| `cmc release [N…]` | Hands messages to the agent at its next tool call (or when its turn ends, if it makes none). |
| `cmc release --end [N…]` | Hands them over when its turn ends. |
| `cmc sessions [--all]` | Shows the open sessions started in this folder, or every session cmc knows. |

If no session is open in the folder, `cmc` says so and stores nothing. If several are, it lists them and you
pick one with `--session <id>` (the first characters of the id are enough).

How sure each delivery is:

- **End of turn** (`;;end`, `/cmc:release`) is the dependable path: the text arrives as a new instruction.
- **Now** (`;;now`, `cmc release`) rides on the turn that is running, and it is **unreliable while the agent
  is busy**. The agent always receives the text between two steps, but it is the model that decides what to do
  with text arriving mid-task: in repeated tests with a small model it acted on it in about four runs out of
  ten and otherwise set it aside as not part of its task. A message is handed over exactly once, so one the
  model ignores is gone from the queue. Use `;;now` when the agent is idle (it starts a turn with the
  messages, which is dependable) and `;;end` while it is working.

### Indicator

While something is held, `✉ 2 held` is pinned under the prompt. It follows the queue within about a second,
whoever changes it (the session or the `cmc` command line), and disappears when the queue is empty.

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
- The queue survives closing the terminal: resume the session (`claude --continue` or `--resume`) and the
  held messages are still there; cmc reminds you how many. A compaction does not touch them. Sessions left
  inactive for more than 30 days are cleaned up, with whatever they still held.
- If the plugin itself fails, your prompt goes to the agent as if the plugin were not installed, and the
  error is written to `cmc.log` in the data directory. A message is never dropped silently.

## Development

```
npm test        # node --test
npm install     # development only: TypeScript and the Node type definitions
npm run types   # tsc --noEmit, strict
npm run lint    # syntax check of every module
claude plugin validate .              # the marketplace
claude plugin validate ./plugins/cmc  # the plugin
```

`node scripts/e2e.ts` drives a real headless Claude Code session with this checkout loaded and types
messages into it while it works (it spends tokens, so it is not part of `npm test`). See
[docs/manual-test.md](docs/manual-test.md) for the scenarios and for the checks that need the interactive
terminal.

## Author

Peterson Sena (r3v3rs3)
