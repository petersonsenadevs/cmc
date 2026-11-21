# ADR 002 — Dispatching to a second agent: how it gets its context

- **Status:** accepted · **Date:** 2026-11-21 · **Author:** Peterson Sena (r3v3rs3)
- **Task:** F3-T1 · **Evidence:** `spike/fork-test.mjs`

## Context

`>> task` must start a second agent that knows what the session knows and works in parallel, without
disturbing the first one. The candidate is `claude -p --resume <id> --fork-session`. Whether it works while
the origin session is in the middle of a turn was not documented.

Setup: Claude Code 2.1.330, Windows 11, Node 24.4.1, model `haiku` for origin and forks. The script creates
a git repository with one file, starts an origin session (read the file, then three `sleep 8; echo stepN`
Bash calls) and, two seconds into the second sleep, starts four forks that are asked — without tools — what
the codename is, what the task was and which steps have finished. Two runs; the first only failed to parse
the output (`--output-format json` prints an array of messages, not one object).

**Limit of the evidence:** one valid run, Windows only, headless origin. The origin of a real dispatch is an
interactive session; nothing in the mechanism depends on that, but it was not driven.

## Findings

### (a) Does the fork start while the origin is mid-turn, and is the origin left alone? — Yes

```
13.4s  ORIGIN-TOOL  #3 sleep 8; echo step2
15.4s  FORK         origin 10448be4-… is mid-turn; starting forks
19.9s  FORK-SAME    exit=0 session=05c2e32e-… sameAsOrigin=false
22.8s  ORIGIN-TOOL  #4 sleep 8; echo step3
31.9s  ORIGIN       HERON — step1, step2, step3
```

Each fork got its own session id and an answer in about five seconds. The origin went on to step 3 and
finished with the expected result. Four forks of the same session ran at the same time without trouble.

### (b) What does the fork see when the transcript ends in a tool call with no result? — An interrupted call

> HERON is the codename from notes.txt; I was asked to run three sleep-and-echo Bash steps […]; step1
> finished (output "step1"), while step2 was interrupted before its result came back, so I don't know
> whether […]

The fork has everything up to the pending call (it knew the content of the file the origin had read) and
treats the pending call as interrupted, outcome unknown. It did not try to run it again.

### (c) Can it be launched detached from a process that exits at once? — Yes

A launcher process spawned the fork with `detached: true`, `stdio: ['ignore', file, file]`,
`windowsHide: true` and `unref()`, printed the pid and exited with code 0 within 0.1 s. The fork kept
running, wrote its JSON result to the file and exited by itself.

### (d) Which flags have to be passed again?

- The fork is a new process: `--model`, `--plugin-dir`, permission flags and `--setting-sources` are whatever
  the new command line says. Nothing is inherited from the origin's command line.
- `--resume <id>` found the session **from a different working directory** (`FORK-OTHERCWD` answered
  correctly). The fork does not have to start in the origin's folder.
- `--worktree <name>` combines with `--resume --fork-session`: the fork answered correctly and git shows a
  new worktree under `<repo>/.claude/worktrees/` on the branch `worktree-<name>`. Claude Code creates the
  worktree itself.

### (e) What does a fork cost, compared with a context pack?

| | Input tokens | Cost |
|---|---|---|
| Fork (whole history) | 45 767, of which 43 726 read from cache | $0.00089 |
| Fresh session + a three-line context pack | 25 109 | $0.00174 |

In this short session the fork was **cheaper**: it carries more tokens, but almost all of them are a cache
read, because it repeats the origin's prefix on the same model minutes later. The fresh session pays to write
its own system prompt into the cache. The fork's cost grows with the length of the history and loses the
discount when the cache has expired or the fork uses another model; the pack's cost is flat.

## Decision

1. **Default context mode: fork** (`claude -p <task> --resume <id> --fork-session`), on the model of the
   origin session. S4 is confirmed.
2. **Context pack** (F3-T4) stays as the alternative the user picks (`--mode pack`) for long sessions, for a
   different model, or when the origin's history should not travel; it is also the fallback when the fork
   cannot start.
3. **Isolation: Claude Code's own `--worktree <name>`**, named `cmc-<agent id>`. In a folder without git the
   flag is not passed, the agent works in the same folder and the user is told (S5). F3-T3 no longer creates
   the worktree by hand; it names it, finds it and cleans it up.
4. **Launch** (F3-T2): `spawn` with an argument array (no shell), `detached: true`, output to a per-agent log
   file, `windowsHide: true`, `unref()`. `--output-format stream-json --verbose` for the log.
5. **Flags the launcher always sets**: `--plugin-dir`/plugin loading is left to the user's own configuration
   (an installed plugin loads by itself); `--permission-mode acceptEdits` and the configured tool list
   (D-002). Never `bypassPermissions`.
6. The dispatched agent is told in its prompt that it is a fork working in parallel, that the last tool call
   it sees may still be running in the origin, and that it must not repeat the origin's work.

## Consequences

- A fork inherits the whole conversation, including anything the user would not want a second agent to act
  on. The dispatch prompt scopes it to the task; the pack mode exists for the cases where that is not enough.
- If the dispatched agent has cmc loaded, its own hooks run: it gets its own session id and its own empty
  queue, so nothing is shared by accident. Its `Stop` hook must not deliver the origin's queue (different
  session id: it cannot).
- The worktree lives inside the repository (`.claude/worktrees/`), which the user may want in `.gitignore`.
- Cost is shown to the user as "inherits the whole conversation" at dispatch time; the numbers above are one
  measurement, not a promise.

## How to reproduce

```
node spike/fork-test.mjs <scratchDir>
```
