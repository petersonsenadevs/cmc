# Test script — phase 1 (hold and release)

Two parts: scenarios a script can drive against a real headless session, and the same scenarios in the
interactive terminal, which only a person can run.

## Part A — headless, scripted

Each command starts `claude -p` with this checkout as a plugin, asks for three five-second Bash steps and
types the `--mid` messages two seconds into the first one.

| # | Command | Pass when |
|---|---|---|
| A1 | `node scripts/e2e.ts --mid ";; also reply with the word pineapple"` | A `NOTICE … Held (1 queued)` line appears after step 1; steps 2 and 3 still run; the `AGENT` answer lists the three steps and does not say "pineapple"; `QUEUE 1 held`. |
| A2 | `node scripts/e2e.ts --mid ";; also reply with the word pineapple" --mid ";; and then the word mango" --after "/cmc:release"` | Two `Held` notices; first answer without the words; after `/cmc:release` the agent answers with both words, in that order; `QUEUE 0 held`. |
| A3 | `node scripts/e2e.ts --mid ";; also reply with the word papaya" --mid ";;end"` | Notice `1 held message(s) will be released when this turn ends`; after the three steps a `DELIVERED Stop hook feedback: [cmc] The user released…` line; the agent answers "papaya"; `QUEUE 0 held`. |

## Part B — interactive terminal

Start `claude --plugin-dir /path/to/this/repository/plugins/cmc` in a scratch folder (or install the plugin
from the marketplace, see the README) and give it a slow task, for example:

> Run `sleep 20; echo one` with Bash, then `sleep 20; echo two`, then tell me both outputs.

| # | While it is working, type | Pass when |
|---|---|---|
| B1 | `;; also say pineapple` and Enter | The agent is **not** interrupted; after the running command ends a notice with `Held (1 queued)` appears; the final answer does not mention pineapple. |
| B2 | (after B1, agent idle) `/cmc:release` | The agent answers with "pineapple". |
| B3 | `;; also say papaya`, Enter, then `;;end`, Enter | Notice `1 held message(s) will be released when this turn ends`; when the task is done the agent continues by itself and says "papaya". |
| B4 | `;; also say mango`, Enter, then `/cmc:release`, Enter, **before the task ends** | The command does nothing until the turn ends; then it runs and the agent says "mango". |
| B5 | (agent idle) `;;` and Enter | Notice `Nothing to hold…`; nothing is queued. |
| B6 | (agent idle) `;; one`, then `;; two`, then `;;clear` | Under the prompt a status line shows `✉ 1 held`, then `✉ 2 held`, within about a second of each message, and disappears after `;;clear`. |

Write down for each row: pass or fail, and what the notice looked like on screen. B1, B3, B4 and B6 are the
ones the headless run cannot prove about the terminal UI.
