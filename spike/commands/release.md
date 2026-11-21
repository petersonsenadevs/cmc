---
description: Release the messages held by the cmc spike
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

The user held the following messages while you were working and is releasing them now. Treat each line as a message from the user, in order:

!`node "${CLAUDE_PLUGIN_ROOT}/drain.mjs" "data=${CLAUDE_PLUGIN_DATA}" "session=${CLAUDE_SESSION_ID}" "args=$ARGUMENTS"`
