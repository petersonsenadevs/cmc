---
description: Release the messages you held with ";;" so the agent receives them now
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/cmc.ts" drain --format prompt --data-dir "${CLAUDE_PLUGIN_DATA}" --session "${CLAUDE_SESSION_ID}"`
