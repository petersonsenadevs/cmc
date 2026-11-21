# ADR 003 — The control panel

- **Status:** accepted (Peterson approved the mockup on 2026-11-21, with the two additions in §3 and §6)
- **Date:** 2026-11-21
- **Task:** F5-T2 · **Follows:** F5-T1 (devlog 032–034)

## Context

F5-T1 proved the panel works in Peterson's terminal: Claude Code's own pane opens beside the chat, buttons take mouse clicks, and it
redraws by itself. His verdict on the first version: "it did it in the end, but in a way that is not intuitive; the UI must be the nerve
centre to control everything in a simple way". What went wrong in his test:

- Feedback came as loose toasts over the chat: the panel itself never said what happened.
- Subagents were invisible: one started, worked and came back, and the panel showed nothing of it.
- Send while the agent worked fell back to the end of the turn ("no live session on this machine has id …"). Live sessions are
  addressed by name (`cmc-prueba-33`), not by session id, and the engine gives a plugin no call that returns its own name.

## Decision

### 1. One place for everything

The panel shows, at all times, the agent's state, every held message, every subagent with its result, and what just happened. A
person never needs a command, a toast or the transcript to know where things stand. The commands (`;;`, `/held`, `/send`, `>>`, the
`cmc` CLI) stay, for those who do not use the panel.

### 2. Mockup (terminal, 110+ columns)

```
 cmc                                                         ● Agent working · 1m 12s
 ─ MESSAGES · 2 ─────────────────────────────────────────────── [ Send all ] [ Clear ]
 ▸ 1  also say kiwi                                 goes when the turn ends
      [ Send now ] [ To subagent ] [ Edit ] [ ↑ ] [ ↓ ] [ Delete ]
   2  review the README for typos                   goes when the turn ends
 ┌──────────────────────────────────────────────────────────────┐
 │ Hold a message…                                              │ [ Hold ] [ To subagent ]
 └──────────────────────────────────────────────────────────────┘
 ─ SUBAGENTS · 2 ──────────────────────────────────────────────────────── [ New task ]
 ⟳ e3a6971f  summarise what we talked about        working · 0:42 · whole conversation
      [ Log ] [ Message… ] [ Stop ]
 ✓ 6e3ccfc8  reply with the word tangerine          done · 27s · branch worktree-cmc-6e3ccfc8
      │ tangerine
      [ Send to main ] [ To subagent… ] [ Message… ] [ Copy path ] [ Dismiss ]
 ─ ACTIVITY ───────────────────────────────────────────────────────────────────────────
  19:43  subagent e3a6971f started with the whole conversation
  19:42  "also say kiwi" goes when the turn ends (the agent is mid-step)
```

- **Rows are selectable.** A click on a row selects it (`▸`) and shows its buttons; the others stay one clean line. Keyboard: arrows
  move the selection, Enter is the primary action, hotkeys `s` send, `a` to subagent, `e` edit, `d` delete.
- **Each row says what will happen to it:** "goes when the turn ends", "held until you send it" (`sendAtEnd: false`), "sending…".
- **Edit happens in the row** (`Input`), and keeps the message in its place.
- **The input box holds a message without typing `;;`.** "To subagent" next to it starts a subagent on what was typed.
- **Subagents show their result inline** (first lines), and act on it: hand it to the main agent, pass it to another subagent, write
  to the subagent again (F5-T6/T7), copy the worktree path, dismiss.
- **Activity** replaces toasts: the last five things that happened, in the panel. Errors are shown there in the error colour.
- **Narrow terminals:** under 110 columns the panel is not seated by the engine; `/cmc` says so and `/held` still works.
- **Empty state:** one line on how to hold (`;; message`, or the input box) and how to start a subagent.

### 3. Send now

Peterson: "when I press Send it must go straight away, as Ctrl+Enter would". What Ctrl+Enter does in Claude Code 2.1.330
(`chat:sendNow`, documented in code.claude.com/docs/en/keybindings and interactive-mode): it sends the draft and the queued messages
at once; work that can move to the background (shell commands, subagents) keeps running and Claude reads the message in the same turn;
otherwise it interrupts the turn and sends the message next. No plugin call presses that key or invokes the action, and neither
`$.prompt.submit` (it waits until the session is idle) nor `$.session.send` (live sessions are addressed by a name the engine does not
give a plugin, and it is not the local prompt box) does the same; a probe confirmed the second refuses.

So Send hands the message to Claude Code's own send-now:

- **Agent idle:** submitted as a new prompt at once (as today).
- **Agent working:** the text goes into the prompt box (`$.prompt.fill`, which works mid-turn; after the draft, if there is one) and the
  row says "Ctrl+Enter to send it now". Ctrl+Enter (or Ctrl+X Ctrl+S, where the terminal does not report Ctrl+Enter) sends it with the
  engine's own behaviour, as a real message from the person. The message leaves cmc's queue when the person sends it: the interface's
  `prompt.submit` hook sees the text go and takes the message then; until then it stays held, and Escape or deleting the draft loses
  nothing.
- This replaces D-037 (`$.session.send` to the session itself).

### 6. A conversation per subagent

Peterson: "I want to see what is sent to the subagent and what it answers". Selecting a subagent opens its conversation in the panel:

```
 ─ SUBAGENT e3a6971f · working · 0:42 · whole conversation · branch worktree-cmc-e3a6971f ── [ Back ]
  You   summarise what we talked about
  ⟳     Read README.md · Grep "release" · …                      (its steps, as they happen)
  Agent We set up a plugin that holds messages…                  (its answer, whole, scrollable)
  You   now list the open tasks                                  (a message written to it afterwards)
  Agent 1. F5-T3 …
 ┌──────────────────────────────────────────────────────────────┐
 │ Write to e3a6971f…                                           │ [ Send ] [ Send to main ] [ Stop ]
 └──────────────────────────────────────────────────────────────┘
```

- **What was sent:** the task as the person wrote it, and what context went with it (the whole conversation, or the summary, which can
  be expanded).
- **What it does:** its steps while it works (tools and their target), from its log.
- **What it answers:** its final answer, whole, not only the first lines; and each answer to a later message.
- **Writing to it:** the box at the bottom (F5-T6). A message to a working subagent reaches it after its current step, through its own
  input (`stream-json` on its standard input, the native way a headless session takes messages mid-turn); to a finished one, its
  session is resumed in its worktree.

### 4. Colours

The panel uses a small palette of its own, applied only to accents (state dots, the selected row, primary buttons), so it sits well on
any theme. Proposed for cmc (Peterson's product, r3v3rs3):

| Role | Colour |
|---|---|
| Accent (selection, primary buttons) | `#7C5CFF` violet |
| Working | `#F5A524` amber |
| Done | `#2BB673` green |
| Error | `#E5484D` red |
| Secondary text | the theme's dim colour |

Peterson chose the violet palette (2026-11-21).

### 7. Modes and comfort

Peterson: "the UI must be more interactive, with comfortable options and modes". The panel has three views and a strip of modes, all
one click (or one key) away:

```
 cmc  ● Agent working      [ Messages 2 ] [ Subagents 1 ] [ Activity ]
 Deliver: ( End of turn | Hold )   Typed ;; goes to: ( Main | Subagent )   Subagent context: ( Full | Summary )   Results: ( Hold | Auto )
```

- **Views:** Messages, Subagents, Activity, as tabs (keys `1` `2` `3`). The selected tab and the selected row are drawn in the accent.
- **Deliver:** End of turn (`sendAtEnd: true`) or Hold (held until sent).
- **Typed `;;` goes to:** Main (held for the main agent, as today) or Subagent: every `;; message` starts a subagent on it, so the
  main conversation stays clean (setting `holdTarget`).
- **Subagent context:** Full (a copy of the conversation) or Summary (`dispatch.context`).
- **Results:** Hold (a subagent's result waits in the queue) or Auto (it goes to the main agent when a turn ends) (`dispatch.return`).
- A mode is a setting: a click writes it to `config.json` through `cmc config set`, so the panel, the commands and the CLI agree, and
  it survives a restart.
- **Comfort:** rows highlight under the pointer; a click selects, a second action button does the rest; edits happen in the row; the
  input box at the bottom holds (or, in Subagent mode, dispatches) without typing a prefix; every action leaves a line in Activity; the
  last two lines of Activity show under every view.

### 8. A hub, with its name

Peterson: "the name must have its title and say by r3v3rs3, and room for the logo when we have it; it will basically be a hub". The
panel is the hub of cmc: the header shows the mark "cmc" in two lines of half blocks (violet), then "Claude Message Control" and
"by r3v3rs3"; the pane's tab reads "cmc hub". The terminal keeps the half-block mark (it reads at any size and on any theme); the
logo proper, made from the brief in `senzu/design-system/cmc/logos/brief.md`, goes at the top of the README (`<picture>`, dark and
light), where the same mark stands until it exists.

The hub also chooses how subagents work: their model (`dispatch.model`: inherit, or an alias such as `opus`, `sonnet`, `haiku`,
`fable`, or a full model name) and their effort (`dispatch.effort`: inherit, `low`, `medium`, `high`, `xhigh`, `max`), passed to
Claude Code as `--model` and `--effort`, for every subagent or for one task (F5-T11).

### 5. Data and actions

Unchanged from F5-T1: the panel reads the session files (queue, state, agents) every second and redraws on change; every action goes
through the `cmc` CLI, so the core, its lock and its rules are the same as everywhere. No action loses a message (D-034).

## Consequences

- The panel becomes the main way to use cmc in the terminal; the README leads with it.
- F5-T3 (messages), F5-T4 (subagents), F5-T5 (new task), F5-T6/T7 (talking to subagents) and F5-T8 (opening) build this mockup.
- Delivering into the running turn depends on the engine accepting a message to the session itself; the prompt-box fall back keeps
  Send immediate when it does not.
