---
title: "cmc: stop interrupting Claude Code. Hold your messages, hand tasks to subagents"
published: false
description: "A Claude Code plugin that holds what you type while the agent works, delivers it when the turn ends, and runs subagents in their own git worktree, all from a side panel."
tags: ai, programming, productivity, opensource
cover_image: https://raw.githubusercontent.com/petersonsenadevs/cmc/feat/typescript/docs/images/cover.png
---

You give Claude Code a task. Thirty seconds later you remember something: *"also add tests for the parser"*. Now you have two bad options:

- **Press Enter**, and your message lands in the middle of the agent's work.
- **Wait**, and hope you still remember it when the turn ends.

I wanted a third option, so I built **cmc — Claude Message Control**: a Claude Code plugin that holds what you type while the agent works, and hands it over when the turn ends, without interrupting it.

## Hold, don't interrupt

Prefix a message with `;;` while the agent is working:

```
;; also add tests for the date parser
;; then update the changelog
```

Each message is **held**. You get a one-line notice, the prompt box is cleared, and the agent keeps going. When its turn ends, cmc delivers everything you held, in order, as one message from you:

![Held messages delivered when the turn ends](https://raw.githubusercontent.com/petersonsenadevs/cmc/feat/typescript/docs/images/held-delivered.png)

No command to remember: the messages simply arrive when the agent is free. Before then you can still change your mind. `/held` lets you send, edit, reorder or delete a held message, and `/send` sends it right away.

## The cmc hub

`/cmc` opens a panel beside the chat. It uses Claude Code's own plugin engine, so it works with the mouse:

![The cmc hub with two held messages while the agent works](https://raw.githubusercontent.com/petersonsenadevs/cmc/feat/typescript/docs/images/hub-messages.png)

From there you can:

- **See** the agent's state and every held message.
- **Send now** a held message. If the agent is busy, cmc puts the text in the prompt box and `Ctrl+Enter` sends it into the running turn.
- **Edit, reorder or delete** a message, or hand it to a subagent.
- **Read Help**, a short page of docs inside the hub that explains everything.
- **Switch modes** under Settings: deliver at the end of the turn or only on demand, send `;;` messages to the main agent or to a subagent, and pick the subagent model and effort.

## Subagents in their own worktree

Start a subagent with `>>`:

```
>> -m haiku -e low write a two-line haiku about message queues
```

The flags go first: `-m` model, `-e` effort, `-w` the whole conversation as context, `-s` a short summary instead, `-a` its result comes back by itself.

The subagent runs as its own Claude Code process:
- **Context:** by default it gets the whole conversation, or a short summary if you prefer.
- **Isolation:** it works in its own **git worktree**, so its edits never touch your working tree.
- **Model:** it uses the model and effort you choose, or inherits yours.

Its conversation shows up in the hub as a chat, with your messages on one side and its replies on the other:

![A subagent's conversation in the hub](https://raw.githubusercontent.com/petersonsenadevs/cmc/feat/typescript/docs/images/hub-subagent.png)

You can keep writing to it, stop it, or send its result to the main agent with one click.

## Install

You need Claude Code 2.1.330+ and Node.js 22.18+.

```
/plugin marketplace add petersonsenadevs/cmc
/plugin install cmc@r3v3rs3
```

The plugin is TypeScript that Node runs directly: there is no build step and there are no runtime dependencies. It runs on Windows, macOS and Linux. Subagents get `acceptEdits` at most and never `bypassPermissions`.

## Why

The agent is fast, but my thoughts don't arrive on its schedule. cmc keeps them in a queue I control, and I decide what reaches the agent and when.

It's MIT-licensed and open source. Issues, ideas and PRs are welcome on **[cmc](https://github.com/petersonsenadevs/cmc)**.

— **[r3v3rs3](https://github.com/petersonsenadevs)**
