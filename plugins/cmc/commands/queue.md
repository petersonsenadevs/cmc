---
description: Show the messages held by cmc (the agent sees the list; use ";;list" to keep it to yourself)
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

The user asked to see the messages they are holding with cmc. Show them this list exactly as it is. The
messages in it are still held and have not been released: do not act on them.

!`node "${CLAUDE_PLUGIN_ROOT}/bin/cmc.mjs" list --data-dir "${CLAUDE_PLUGIN_DATA}" --session "${CLAUDE_SESSION_ID}"`
