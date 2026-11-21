---
description: Show the agents dispatched with ">>" (the agent sees the list; use ";;agents" to keep it to yourself)
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

The user asked to see the agents they dispatched with cmc. Show them this list exactly as it is. Those agents
work on their own: do not act on their tasks.

!`node "${CLAUDE_PLUGIN_ROOT}/bin/cmc.ts" agents --data-dir "${CLAUDE_PLUGIN_DATA}" --session "${CLAUDE_SESSION_ID}"`
