# cmc — Claude Message Control

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="plugins/cmc/assets/logo-dark.png">
  <img alt="cmc — Claude Message Control, by r3v3rs3" src="plugins/cmc/assets/logo-light.png" width="600">
</picture>

by [r3v3rs3](https://github.com/petersonsenadevs)

[![Version](https://img.shields.io/badge/version-1.1.1-7C5CFF)](CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-2BB673)](LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-%E2%89%A5%202.1.330-555)](https://code.claude.com/docs)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A5%2022.18-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-no%20build-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-555)](#known-limits)
[![Plugin](https://img.shields.io/badge/Claude%20Code%20plugin-hub-7C5CFF)](#the-cmc-hub)

A Claude Code plugin that puts you in control of the conversation with the agent: **hold** what you type while it works
and it reaches the agent when its turn ends, without interrupting it; change, reorder or delete it before then; and hand
tasks to **subagents** that work in parallel, in their own git worktree, and talk back to you. Everything from one panel
beside the chat, the **cmc hub**, with the mouse or the keyboard.

Version 1.1.1 · MIT license · see [CHANGELOG.md](CHANGELOG.md).

## Requirements

- Claude Code 2.1.330 or newer (the hub uses Claude Code's plugin engine)
- Node.js 22.18 or newer. The plugin is written in TypeScript and Node runs the `.ts` files directly: there is no
  build step and nothing to install besides the plugin folder (no runtime npm dependencies)

## Install

This repository is a Claude Code marketplace (`r3v3rs3`) that holds the plugin in `plugins/cmc`. Add the marketplace,
then install the plugin from it:

```
/plugin marketplace add petersonsenadevs/cmc
/plugin install cmc@r3v3rs3
```

From a terminal: `claude plugin marketplace add petersonsenadevs/cmc` and `claude plugin install cmc@r3v3rs3`. Add
`--scope project` to both to enable it for one project only. A local checkout works too: `claude plugin marketplace add
/path/to/the/checkout`, or `claude --plugin-dir /path/to/the/checkout/plugins/cmc` to try it without installing.

Update and remove:

```
claude plugin marketplace update r3v3rs3 && claude plugin update cmc@r3v3rs3   # held messages and settings are kept
claude plugin uninstall cmc@r3v3rs3              # also deletes held messages and settings; add --keep-data to keep them
claude plugin marketplace remove r3v3rs3
```

## In one minute

1. While the agent works, type `;; also update the README` and press Enter. The message is **held**: the agent is not
   interrupted, and the message reaches it **when its turn ends**.
2. The **cmc hub** opens beside the chat (or type `/cmc`). There you see what is held and can send it now, edit it,
   reorder it, delete it, or hand it to a subagent.
3. Type `>> review the tests of module X` to start a **subagent** on a task. It works apart, in its own worktree, and
   its answer comes back to you; you can keep talking to it from the hub.

## The cmc hub

`/cmc` opens or closes it; by default it also opens by itself when you hold a message or a subagent starts. It needs a
terminal about 110 columns wide or more; below that, `/held` and the control words still do everything.

```
▄▀▀ █▀▄▀█ ▄▀▀   Claude Message Control
▀▄▄ █ ▀ █ ▀▄▄   by r3v3rs3
● Agent working · held messages go to it when its turn ends
[ Messages 2 ] [ Subagents 1 ] [ Activity ] [ Settings ] [ Help ]

What you hold for the agent. Click a message for its actions; type below to hold one without ";;".
Messages delivered when the turn ends · ;; holds for the agent · subagents get the whole conversation

▸ 1  also say kiwi                                   · goes when the turn ends
     [ Send now ] [ To subagent ] [ Edit ] [ ↑ ] [ ↓ ] [ Delete ]
  2  review the README for typos                     · goes when the turn ends
[ Send all ] [ Clear ]
┌───────────────────────────────────────┐
│ Type a message to hold for the agent  │ [ Hold ]
└───────────────────────────────────────┘
                                                                                     v1.1.1  cmc
```

| View (key) | What is in it |
|---|---|
| **Messages** (`1`) | What you hold. A click on a message shows its actions (keys `s` send, `a` to subagent, `e` edit, `d` delete); edits happen in the row. The box at the bottom holds a message without typing `;;`. |
| **Subagents** (`2`) | A box to start a new subagent task, and every subagent with its state, time, context, model and effort. A click opens its **conversation as a chat** — your messages on the right, its answers on the left, its steps in between — with a box to write to it, **Send result to main** and **Stop**. |
| **Activity** (`3`) | What happened, newest first. The latest two lines also show under the other views. |
| **Settings** (`4`) | The modes below, each with a line on what it does. A change applies at once and is kept. |
| **Help** (`5`) | How cmc works, section by section: holding, sending, subagents and their flags, settings, the hub. |

Bottom right: the version, and **cmc**, a link to this repository.

### Send now

**Send now** hands a message over at once. With the agent idle it starts a turn with it. While the agent works, the hub
puts the text in your prompt box and you press **Ctrl+Enter** (or Ctrl+X Ctrl+S where the terminal does not pass
Ctrl+Enter): that is Claude Code's own *send now*, which delivers it into the running turn as your message. The message
leaves the queue when you send it; if you clear the box instead, it stays held. (No plugin can press that key for you,
and handing text into a running turn any other way proved unreliable: the model set it aside more than half the time.)

### Modes (Settings)

| Mode | Values | What it does |
|---|---|---|
| Open the hub | **Automatically** · Only with `/cmc` | Whether the hub opens by itself when you hold a message or a subagent starts. |
| Deliver | **End of turn** · Hold | What you hold while the agent works reaches it when its turn ends, or waits until you send it. |
| Typed `;;` goes to | **Main** · Subagent | A held message waits for the main agent, or starts a new subagent so the main conversation stays clean. |
| Subagent context | **Full** · Summary | A copy of the whole conversation, or a short summary (cheaper, less to go on). |
| Results | **Hold** · Auto | A subagent's answer waits in the hub, or goes to the main agent by itself when a turn ends. |
| Subagent model | **Same as mine** · fable · opus · sonnet · haiku | The model new subagents run with (`--model`). A full model name can be set in the settings file. |
| Effort | **Same as mine** · low · medium · high · xhigh · max | How hard they think (`--effort`): lower is faster and cheaper. |

## Holding and sending from the chat

| You type | What happens |
|---|---|
| `;; also update the README` | **Held** (one-line notice). While the agent works, it reaches it when its turn ends; while it is idle, it waits for you. |
| `/held` | A menu (Claude Code's own dialog): pick a message, then Send, Edit, Delete or Hand to an agent. |
| `/send` · `/send 2` | Sends everything, or message 2: now if the agent is idle, or into the prompt box for Ctrl+Enter while it works. |
| `/cmc:release` | Every held message is handed over (when the turn ends, if the agent is working). Works everywhere, also headless. |
| `;;end` · `;;now` | Hand messages over when the turn ends, or now if the agent is idle (`;;end 2`, `;;now 1 3` for some). |

Control words are typed right after the prefix, with no space; the plugin answers them itself (the agent never sees
them and they cost no tokens): `;;list`, `;;edit 2 new text`, `;;rm 2`, `;;clear`, `;;move 3 1`, `;;up 2`, `;;down 2`,
`;;top 3`, `;;bottom 1`, `;;help`. With a space after the prefix it is a message: `;; clear the cache` is held,
`;;clear` empties the queue.

When a turn ends with something still held, one line under the transcript says so. The queue survives closing and
resuming the session (`claude --resume <id>`) and compactions; sessions inactive for 30 days are cleaned up.

## Subagents

| You type | What happens |
|---|---|
| `>> review the tests of module X` | A subagent starts on that task. It forks this conversation, so it knows everything said so far. |
| `>> --pack --model sonnet --effort low task` | With a short summary instead, and its own model and effort (`--model=sonnet` works too). |
| `>> -s -m sonnet -e low task` | The same, short: `-m` model, `-e` effort, `-w` whole conversation, `-s` summary, `-a` its result comes back by itself. Flags go first. |
| `;;dispatch 2` | Hands held message 2 to a subagent instead of the main agent (flags as above). |
| `;;tell 1a2b now list the open tasks` | Writes to subagent `1a2b…`: it reads it after its current step, or its closed session is resumed with it. |
| `;;agents` · `;;log 1a2b` · `;;cancel 1a2b` | Lists the subagents, shows what one did, stops one. |

- **Its own worktree.** In a git repository it works in `.claude/worktrees/cmc-<id>` on the branch `worktree-cmc-<id>`,
  so it never touches the files the main agent is working on. When its session closes, a worktree with changes is kept
  for you to review and merge; one without changes is removed. Add `.claude/worktrees/` to your `.gitignore`. Outside git
  it works in the same folder, and says so.
- **A conversation.** After it answers, its session stays open (`dispatch.keepOpenMinutes`, 10 by default) so you can
  write to it; each answer comes back to the hub, labelled as the subagent's report, not as something you typed.
- **Limited permissions.** `acceptEdits`, and only the built-in tools `Read`, `Glob`, `Grep`, `Edit`, `Write` (no shell, no
  web), whatever your settings allow; never `bypassPermissions`. Tools from MCP servers are not covered by that limit.
  Restricting the tools makes a fork miss the session's prompt cache, so it costs more; `"restrictTools": false` trades
  the limit for the lower cost.
- **Your setup runs in it.** Your other plugins and hooks run in the subagent too. If some of them write files into its
  worktree (notes, memory), list those paths in `dispatch.ignoreChanges` so they do not count as its work.

## From another terminal

Run `cmc` in a second terminal **in the folder where the session was started**: `cmc hold <text>`, `cmc list`, `cmc edit`,
`cmc rm`, `cmc move`, `cmc release`, `cmc dispatch [--pack] [--model …] [--effort …] <task>`, `cmc agents`, `cmc tell <id>
<text>`, `cmc log <id>`, `cmc cancel <id>`, `cmc config [init | set <mode> <value>]`, `cmc sessions`. `cmc help` lists
them all.

Installed from the marketplace, the command is in Claude Code's plugin cache, under a folder named after the version:
`node ~/.claude/plugins/cache/r3v3rs3/cmc/1.1.1/bin/cmc.ts list` (an alias helps, since the path changes with each
update). From a checkout: `node /path/to/the/checkout/plugins/cmc/bin/cmc.ts`, or `npm link` in the repository.

## Settings file

Everything works without it. `cmc config init` writes `config.json` in the plugin data directory with every setting at
its default; `cmc config` shows the settings in force and any problem in the file; the hub's Settings view and
`cmc config set <mode> <value>` switch the modes.

```json
{
  "holdPrefix": ";;",
  "dispatchPrefix": ">>",
  "sendAtEnd": true,
  "holdTarget": "main",
  "panelAutoOpen": true,
  "dispatch": {
    "context": "fork",
    "return": "held",
    "model": "inherit",
    "effort": "inherit",
    "permissionMode": "acceptEdits",
    "tools": ["Read", "Glob", "Grep", "Edit", "Write"],
    "restrictTools": true,
    "ignoreChanges": [],
    "keepOpenMinutes": 10
  },
  "retentionDays": 30
}
```

| Setting | Values |
|---|---|
| `holdPrefix`, `dispatchPrefix` | 1 to 4 symbols, no letters, digits, spaces or `/`; one cannot start the other. |
| `sendAtEnd` | `true`: held messages reach the agent when its turn ends. `false`: they wait until you send them. |
| `holdTarget` | `main` or `subagent` (a held message starts a subagent). |
| `panelAutoOpen` | `true`: the hub opens by itself when something is held or a subagent starts. |
| `dispatch.context`, `dispatch.return` | `fork` / `pack`; `held` / `auto`. Flags override them per task. |
| `dispatch.model`, `dispatch.effort` | `inherit` (your own setup), an alias or full model name; `low` … `max`. |
| `dispatch.permissionMode` | `acceptEdits`, `default` or `plan`. `bypassPermissions` is never accepted. |
| `dispatch.tools`, `dispatch.restrictTools` | Tools the subagent may use (as `--allowedTools` takes them), and whether it has only those. |
| `dispatch.ignoreChanges` | Paths other tools write into a subagent's worktree, e.g. `[".corvusmem/"]`: not counted as its work. |
| `dispatch.keepOpenMinutes` | How long a subagent's session stays open for your messages after it answers (0 to 240). |
| `retentionDays` | Sessions inactive for longer are deleted with their queue. `0` keeps them forever. |

A wrong value never stops the plugin: that setting falls back to its default and the problem is shown when the next
session starts and in `cmc config`.

## Known limits

- **Terminal only.** Plugins installed from a repository do not reach Claude Code on the web (cloud sessions). The
  desktop app's Code tab loads plugins in local sessions but has not been tested.
- **Send while the agent works needs your Ctrl+Enter**, as explained above.
- **Resuming a subagent after its worktree was removed** (it changed nothing) may fail: Claude Code keeps a session's
  conversation per folder. The hub shows the error; start a new subagent instead.
- **`--continue` and subagents.** `claude --continue` resumes the most recent conversation in the folder; a subagent that
  worked in the same folder (no git) is more recent. Use `claude --resume <id>`.
- **Tested on Windows 11** with Claude Code 2.1.330 and Node 24. It is written for macOS and Linux too (paths, file modes,
  process handling), but the test suite has not been run there yet.
- **Model behaviour.** What the agent does with what you send is up to the model. Messages and subagent reports are
  labelled for what they are, and in every test so far the agent acted on them as expected.

## Security

cmc works only on your machine: no network calls, no runtime dependencies. Held messages, logs, conversations and agent
outputs are stored in the plugin data directory, readable by your user only (on macOS and Linux). Text the plugin
quotes from the session or from a subagent is labelled and fenced, and subagents never run with `bypassPermissions`.

## Development

```
npm install     # development only: TypeScript and the Node type definitions
npm test        # node --test (with test-support/setup.ts)
npm run types   # tsc --noEmit, strict
npm run lint    # syntax check of every module
claude plugin validate .              # the marketplace
claude plugin validate ./plugins/cmc  # the plugin
```

`node scripts/e2e.ts` drives a real headless Claude Code session with this checkout loaded and types messages into it
while it works (it spends tokens, so it is not part of `npm test`). [docs/manual-test.md](docs/manual-test.md) has the
scenarios, including the checks of the hub that need the interactive terminal.

Why cmc works the way it does is in the design records: [capture and release](docs/adr/001-capture-and-release.md),
[dispatch and context](docs/adr/002-dispatch-and-context.md) and [the control panel](docs/adr/003-control-panel.md).

## Author

Peterson Sena · [r3v3rs3](https://github.com/petersonsenadevs)
