# Test script — cmc 1.1

Three parts: scenarios a script drives against a real headless session (A), the basics in the interactive terminal (B),
and the cmc hub (C). B and C need a person: the agent cannot see the terminal.

## Part A — headless, scripted

Each command starts `claude -p` with this checkout as a plugin, asks for three five-second Bash steps and types the
`--mid` messages two seconds into the first one. On Windows with Git Bash, `export MSYS_NO_PATHCONV=1` first, or a
`/command` argument is turned into a path.

| # | Command | Pass when |
|---|---|---|
| A1 | `node scripts/e2e.ts --mid ";; also say the word pineapple"` | `NOTICE … goes to the agent when its turn ends`; steps 2 and 3 still run; after them `DELIVERED Stop hook feedback: [cmc] The user typed this message while you were working…`; the agent says "pineapple"; `QUEUE 0 held`. |
| A2 | `node scripts/e2e.ts --mid ";; also reply with the word papaya" --mid ";;end"` | Both notices; after the three steps the agent says "papaya"; `QUEUE 0 held`. |

## Part B — interactive terminal, the basics

Start `claude --plugin-dir /path/to/the/checkout/plugins/cmc` in a scratch git folder (or install the plugin, see the
README) and give it a slow task, for example:

> Use the Bash tool three times, one after the other: `sleep 8; echo one`, then `sleep 8; echo two`, then `sleep 8; echo three`. Then tell me the three outputs.

| # | Do | Pass when |
|---|---|---|
| B1 | While it works: `;; also say pineapple`, Enter | The agent is **not** interrupted; one line `cmc: held (1) · goes to the agent when its turn ends`; the prompt box is empty again. |
| B2 | Wait for the task to end | The agent goes on by itself and says "pineapple". |
| B3 | Agent idle: `;; say mango`, then `/held` | Claude Code's dialog asks what to do with message 1; **Send** → the agent says "mango". |
| B4 | Agent idle: `;; one`, `;; two`, then `/send 2` | The agent gets "two"; "one" stays held. |
| B5 | Agent idle: `;; one`, `;; two`, then `;;clear` | Under the prompt `✉ 1 held`, then `✉ 2 held`, then nothing. |
| B6 | While it works, press Esc; then `;; kiwi` and `/send` | The agent gets "kiwi" at once (cmc knows it is idle after Esc). |

## Part C — the cmc hub

Make the terminal at least 110 columns wide.

| # | Do | Pass when |
|---|---|---|
| C1 | `/cmc`, then `/cmc` again | The hub opens beside the chat (tab "cmc hub"), then closes. |
| C2 | Hub closed; while the agent works, `;; hello` | The hub opens by itself, with the message in Messages, "· goes when the turn ends". |
| C3 | Header | The violet mark, "Claude Message Control", "by r3v3rs3"; a click on "by r3v3rs3" opens github.com/petersonsenadevs. Bottom right: `v1.1.0` (and the repository, once the manifest names it). |
| C4 | Click a message | Its actions appear: Send now, To subagent, Edit, ↑, ↓, Delete. **Edit** changes it in the row and keeps its place; **↑**/**↓** reorder; **Delete** removes it. Activity says what happened. |
| C5 | Agent idle: **Send now** on a message | The agent gets it at once; Activity: "Sent 1 message to the agent." |
| C6 | Agent working: **Send now**, then Ctrl+Enter | The text appears in the prompt box; Ctrl+Enter sends it into the running turn; the message leaves the hub. |
| C7 | Type in the box at the bottom of Messages, **Hold** | Held, as if typed with `;;`. |
| C8 | **Settings** (key 4) | Every mode with a line on what it does. Switch "Typed ;; goes to" to **Subagent**: `;; summarise this` now starts a subagent. Switch it back. |
| C9 | Settings: **Subagent model** haiku, **Effort** low; Subagents: **New subagent task** "reply with the word tangerine", **Start** | The subagent appears with "· haiku · effort low", working, then waiting; its row says what it got. |
| C10 | Click the subagent | Its conversation as a chat: your task on the right, its answer on the left, its steps in between. |
| C11 | Write to it in its box: "now say mango", **Send** | Your message on the right, its answer "mango" on the left. |
| C12 | **Send result to main** | The main agent gets the subagent's report, labelled as such. |
| C13 | **Stop** on a waiting subagent | It shows as cancelled. |
| C14 | Settings: **Open the hub** → Only with /cmc; close the hub; `;; again` | The hub stays closed until `/cmc`. |

Write down for each row: pass or fail, and anything that was unclear on screen.
