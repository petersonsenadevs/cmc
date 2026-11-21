# ADR 001 — Capture and release of held messages

- **Status:** accepted · **Date:** 2026-11-21 · **Author:** Peterson Sena (r3v3rs3)
- **Task:** F1-T1 · **Evidence:** `spike/` (probe plugin + headless driver)

## Context

`cmc` holds messages the user types while the agent is working and releases them on demand. None of the
behaviour this depends on is documented for messages sent in the middle of a turn, so it was measured before
building anything.

Setup: Claude Code 2.1.330, Windows 11, Node 24.4.1. `spike/drive.mjs` starts
`claude -p --input-format stream-json --output-format stream-json --plugin-dir spike --setting-sources project`,
asks for three sequential `sleep 5; echo stepN` Bash calls and types a second message two seconds into the
first one. `spike/probe.mjs` is registered on `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`
and `Stop` and logs every call. Eight runs: one per scenario, three for the wording test in (f).

**Limit of the evidence:** every run is headless (stream-json input). The interactive terminal UI was not
driven. The manual script of F1-T6 repeats scenarios (a), (b) and (c) in the TUI.

## Findings

### (a) Does `UserPromptSubmit` fire for a message typed mid-turn? — Yes, at the next tool boundary

```
05:16.023 PreToolUse  Bash "sleep 5; echo step1"
05:17.899 DRIVER      send: ;; HELD-ALPHA please also say pineapple
05:21.879 PostToolUse Bash
05:22.051 UserPromptSubmit held=true prompt=";; HELD-ALPHA please also say pineapple"
05:23.328 PreToolUse  Bash "sleep 5; echo step2"
```

The hook does not run when the message is typed: it runs when the native queue hands the message over, right
after the running tool finishes. Until then the message sits in Claude Code's own queue.

### (b) Does blocking it interrupt the agent? — No

Steps 2 and 3 ran normally after the block and the final answer did not mention the held text. Claude Code
emits one warning, and the prompt is dropped (`prompt_kept: false`):

```
UserPromptSubmit operation blocked by hook:
Held by cmc spike

Original prompt: ;; HELD-ALPHA please also say pineapple
```

After the turn, `/cmc-spike:release` delivered the message and the model answered `pineapple`.

### (c) Is a `/command` typed mid-turn expanded? — Only when the turn ends

```
06:33.948 DRIVER      send: /cmc-spike:release
06:37.866 PostToolUse Bash                       (no UserPromptSubmit here)
06:57.222 Stop
06:57.319 UserPromptSubmit prompt="/cmc-spike:release"
06:57.457 drain count=1
```

A plain message sent at the same moment was delivered after step 1; the slash command waited for `Stop`. It
is then expanded correctly and the `` !`…` `` line runs. Two details of that expansion:

- `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}` and `${CLAUDE_SESSION_ID}` are substituted in the command
  body, but the process started by `` !`…` `` has **no** `CLAUDE_PLUGIN_*` environment variables
  (`env={"data":null,"root":null}`). Hook processes do have them.
- Without `disable-model-invocation: true` the model also tried to call the command through the Skill tool
  after receiving its text (denied, harmless, noisy).

### (d) Does `Stop` with `decision: block` deliver `reason`, and is `stop_hook_active` honoured? — Yes

```
06:55.885 Stop stop_hook_active=false blockedWith="STOP-DELTA: before you finish, also reply with the word papaya."
06:57.212 Stop stop_hook_active=true
RESULT: papaya
```

The reason reaches the model as a user-side text block (`Stop hook feedback:\n<reason>`) and it acted on it.
The second `Stop` carries `stop_hook_active: true`.

### (e) Does `PostToolUse` `additionalContext` reach the model in the same turn? — It arrives, but it was not obeyed

The context injected after step 1 was quoted back by the model in that same turn, with this remark: "which I
did not act on because it arrived inside a tool result rather than from you". Text injected next to a tool
result is treated as untrusted data.

### (f) Extra: `UserPromptSubmit` `additionalContext` on a mid-turn prompt — works, wording matters

The user types `;;now`; the hook lets the prompt through and attaches the held messages as
`additionalContext`. Three wordings, one run each:

| Wording of the context | Model acted on the held message |
|---|---|
| `The user typed ";;now" to release these held messages. Treat each line as a message from the user:` + lines | No ("it sat in tool output rather than coming from you") |
| the held lines alone, no framing | No (only reported `;;now`) |
| `[cmc] The user released their held messages with ";;now":` + numbered lines | **Yes** (`lychee`) |

## Decision

1. **Capture** — a `UserPromptSubmit` hook blocks every prompt that starts with the hold prefix (`;;`), stores
   it in the session queue and answers `Held (n queued)`. It works both idle and mid-turn (S2 confirmed
   headless). The session is identified by `session_id` from the hook input.
2. **Manual release** — `/cmc:release` expands to the queue contents through `` !`node … "${CLAUDE_PLUGIN_DATA}"
   "${CLAUDE_SESSION_ID}"` ``: data dir and session id travel as arguments, never as environment. The command
   sets `disable-model-invocation: true`. Typed mid-turn it takes effect when the turn ends (S3 refuted for
   mid-turn expansion); that is documented as its behaviour, not worked around.
3. **Release at the end of the turn** — the `Stop` hook returns `decision: block` with the whole queue in a
   single `reason` (one continuation, far from the limit of 8) and does nothing when `stop_hook_active` is true
   or the queue is empty.
4. **Release "now" (F2-T2)** — the control prompt `;;now`, handled by the same `UserPromptSubmit` hook: the
   prompt passes and the queue goes in `additionalContext` with the wording of the third row above. It lands
   at the next tool boundary. `PostToolUse` `additionalContext` is kept only for the external CLI
   (`cmc release --now`), with the same wording, and is documented as best effort.
5. **Wording of released text** — a short, factual header naming the plugin and the user's own action. No
   imperative framing ("treat this as…"): it is what made the model distrust the text.
6. **State** — everything under `${CLAUDE_PLUGIN_DATA}/sessions/<session_id>/`. With `--plugin-dir` that
   resolves to `~/.claude/plugins/data/<plugin>-inline`.

Plan B (capture only through the external CLI) is not needed.

## Consequences

- A held message is invisible to `cmc` between the keystroke and the next tool boundary; if the turn ends
  first, the hook still sees it as the next prompt and holds it.
- Every held message prints a three-line warning in the session. It doubles as the receipt of the hold.
- "Now" delivery depends on how the model weighs hook context: one run per wording is thin evidence. F2-T2
  re-tests it and the README states it as best effort; delivery at the end of the turn is the reliable path.
- Release text is user-authored input replayed by the plugin, so it must be clearly attributed and never
  contain anything the user did not type (F1-T5, prompt-injection section).

## How to reproduce

```
node spike/drive.mjs <hold|slash|plain|stop|post|now> <workDir> <dataDir>
```

`<dataDir>/probe.log` holds the hook timeline and `<dataDir>/stream-<scenario>.jsonl` the raw session stream.
