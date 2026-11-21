#!/usr/bin/env node
// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Supervisor of one dispatched agent. It is started detached, so it outlives
// the hook that asked for the agent: it runs the agent, keeps its output in a
// log and records how it ended. It also keeps the agent's input open: each
// answer goes back to the session, the conversation is recorded in order, and
// what the user writes to the agent (its inbox) is handed over, while it works
// or after it answers, until the session has been idle for its keep-open time.
//
//   node agent-runner.ts <agentDir>
import { spawn } from 'node:child_process';
import { closeSync, openSync, readFileSync, statSync, writeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { returnResult } from './agent-return.ts';
import { appendConversation, CONVERSATION_FILE, INBOX_FILE, OUTPUT_FILE, PROMPT_FILE, readAgentAt, STDERR_FILE, updateAgentAt } from './agents-registry.ts';
import { recordWorktree } from './dispatch.ts';
import { errorCode } from './errors.ts';
import { describeError, logEvent } from './log.ts';
import { isRecord } from './types.ts';

const SUMMARY_LENGTH = 4000;
/** How often the inbox is checked for messages from the user. */
const INBOX_POLL_MS = 300;
/** How much of a tool's target a conversation step shows. */
const STEP_LENGTH = 80;

/** A conversation step for a tool call: the tool and what it works on. */
export function describeTool(block: Record<string, unknown>): string {
  const name = typeof block.name === 'string' ? block.name : 'tool';
  const input = isRecord(block.input) ? block.input : {};
  const target = [input.file_path, input.path, input.pattern, input.command, input.description, input.url].find((value) => typeof value === 'string');
  const text = typeof target === 'string' ? target.replace(/\s+/g, ' ').trim() : '';
  return text === '' ? name : `${name} ${text.length > STEP_LENGTH ? `${text.slice(0, STEP_LENGTH - 1)}…` : text}`;
}

/** A user message in Claude Code's stream-json input. */
export function userLine(text: string): string {
  return `${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`;
}

/** The last `result` message of a stream-json log, if there is one. */
/**
 * The answer the agent gave to its task: the text of its turn before any
 * `Stop` hook made it go on. The user's own hooks (and other plugins) may
 * continue the turn with requests of their own, and the final `result` is
 * then the reply to those, not to the task. `null` when there was no such
 * continuation, or no text before it.
 */
export function answerBeforeStopHooks(file: string): string | null {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
  const parts: string[] = [];
  for (const line of text.split('\n')) {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      continue; // Not JSON: a partial write or a stray warning.
    }
    if (!isRecord(message) || !isRecord(message.message) || !Array.isArray(message.message.content)) continue;
    for (const block of message.message.content) {
      if (!isRecord(block) || block.type !== 'text' || typeof block.text !== 'string') continue;
      if (message.type === 'user' && block.text.startsWith('Stop hook feedback:')) return parts.length > 0 ? parts.join('\n\n') : null;
      if (message.type === 'assistant' && block.text.trim() !== '') parts.push(block.text.trim());
    }
  }
  return null;
}

function lastResult(file: string): Record<string, unknown> | null {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line?.includes('"result"')) continue;
    try {
      const message: unknown = JSON.parse(line);
      if (isRecord(message) && message.type === 'result') return message;
    } catch {
      // A line that is not JSON (a partial write, a stray warning) is not the result.
    }
  }
  return null;
}

function tail(file: string): string {
  try {
    return readFileSync(file, 'utf8').trim().slice(-SUMMARY_LENGTH);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return '';
    throw error;
  }
}

/**
 * Records the end of the agent, unless the user already cancelled it.
 * @param answered The agent answered at least once: each answer already went
 *   back to the session, so its end only settles the worktree.
 */
function finish(dir: string, exitCode: number | null, failure: string | null, answered = false): void {
  const current = readAgentAt(dir);
  if (!current || current.state === 'cancelled') return;
  if (answered && !failure) {
    updateAgentAt(dir, { state: 'finished', endedAt: new Date().toISOString(), exitCode });
    const settled = current.worktree === null ? null : recordWorktree(dir, current.cwd, current.worktree, current.baseCommit ?? null);
    const files = settled?.changedFiles ?? [];
    appendConversation(
      dir,
      'note',
      settled === null
        ? 'Its session closed.'
        : files.length > 0
          ? `Its session closed. Its changes stay on the branch ${settled.branch ?? ''}: ${files.join(', ')}.`
          : 'Its session closed. It changed no files, so its worktree was removed.',
    );
    return;
  }
  const result = lastResult(join(dir, OUTPUT_FILE));
  const succeeded = !failure && exitCode === 0 && result !== null && result.is_error !== true;
  const summary = succeeded
    ? (answerBeforeStopHooks(join(dir, OUTPUT_FILE)) ?? String(result?.result ?? '')).slice(0, SUMMARY_LENGTH)
    : failure || String(result?.result ?? '').slice(0, SUMMARY_LENGTH) || tail(join(dir, STDERR_FILE)) || `The agent exited with code ${exitCode} and left no result.`;
  updateAgentAt(dir, {
    state: succeeded ? 'finished' : 'failed',
    endedAt: new Date().toISOString(),
    exitCode,
    summary,
    agentSessionId: typeof result?.session_id === 'string' ? result.session_id : null,
    costUsd: typeof result?.total_cost_usd === 'number' ? result.total_cost_usd : null,
  });
  // The agent is gone: its worktree can be removed if it is clean, or described if it holds work.
  const settled = current.worktree === null ? readAgentAt(dir) : recordWorktree(dir, current.cwd, current.worktree, current.baseCommit ?? null);
  // Its result goes back to the session. A failure here must not take the record
  // down with it: the agent's state is already saved, and the error is logged.
  try {
    if (settled) returnResult(settled);
  } catch (error) {
    logEvent(dir, 'error', 'agent result could not be returned to the queue', describeError(error));
  }
}

/** What one turn of the agent said, gathered from its output as it comes. */
interface Turn {
  /** Its answer: what it wrote before any Stop hook of the user's made it go on. */
  texts: string[];
  /** A Stop hook made it go on: what it writes now is not its answer. */
  afterHook: boolean;
}

/**
 * Takes one line of the agent's stream-json output: records it in the
 * conversation, and at the end of a turn returns the answer to the session.
 */
function onOutput(dir: string, line: string, turn: Turn, onTurnEnd: (answer: string, result: Record<string, unknown>) => void): void {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return; // Not JSON: a stray warning.
  }
  if (!isRecord(message)) return;
  if (message.type === 'result') {
    // An answer given only as the result (no text block before it) still joins the conversation.
    if (turn.texts.length === 0 && typeof message.result === 'string' && message.result.trim() !== '') appendConversation(dir, 'agent', message.result.trim());
    onTurnEnd(turn.texts.join('\n\n') || String(message.result ?? ''), message);
    turn.texts = [];
    turn.afterHook = false;
    return;
  }
  if (!isRecord(message.message) || !Array.isArray(message.message.content)) return;
  for (const block of message.message.content) {
    if (!isRecord(block)) continue;
    if (message.type === 'user' && block.type === 'text' && typeof block.text === 'string' && block.text.startsWith('Stop hook feedback:')) {
      turn.afterHook = true;
      appendConversation(dir, 'note', 'Your own hooks made it go on after its answer.');
    } else if (message.type === 'assistant' && block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
      if (turn.afterHook) appendConversation(dir, 'aside', block.text.trim());
      else {
        turn.texts.push(block.text.trim());
        appendConversation(dir, 'agent', block.text.trim());
      }
    } else if (message.type === 'assistant' && block.type === 'tool_use') {
      appendConversation(dir, 'step', describeTool(block));
    }
  }
}

/** Reads what was added to the inbox since `offset`: the messages and the new offset. */
function readInbox(dir: string, offset: number): { messages: string[]; offset: number } {
  let size: number;
  try {
    size = statSync(join(dir, INBOX_FILE)).size;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { messages: [], offset };
    throw error;
  }
  if (size <= offset) return { messages: [], offset };
  const text = readFileSync(join(dir, INBOX_FILE)).subarray(offset).toString('utf8');
  // Only whole lines: a line still being written is read next time.
  const end = text.lastIndexOf('\n');
  if (end < 0) return { messages: [], offset };
  const messages = text
    .slice(0, end)
    .split('\n')
    .flatMap((one) => {
      try {
        const entry: unknown = JSON.parse(one);
        return isRecord(entry) && typeof entry.text === 'string' && entry.text.trim() !== '' ? [entry.text] : [];
      } catch {
        return [];
      }
    });
  return { messages, offset: offset + Buffer.byteLength(text.slice(0, end + 1)) };
}

function main(dir: string): void {
  const record = readAgentAt(dir);
  if (!record) throw new Error(`no agent record in ${dir}`);
  if (record.state === 'cancelled') return;

  const [executable, ...args] = record.command;
  if (executable === undefined) throw new Error('the agent record has no command to run');
  // Owner only: the agent's output can quote files of the project.
  const out = openSync(join(dir, OUTPUT_FILE), 'a', 0o600);
  const err = openSync(join(dir, STDERR_FILE), 'a', 0o600);
  const child = spawn(executable, args, { cwd: record.resumeCwd ?? record.cwd, stdio: ['pipe', 'pipe', err], windowsHide: true });
  let settled = false;
  let answered = (record.turns ?? 0) > 0;
  let poll: NodeJS.Timeout | undefined;
  let idle: NodeJS.Timeout | undefined;
  const settle = (exitCode: number | null, failure: string | null): void => {
    if (settled) return;
    settled = true;
    clearInterval(poll);
    clearTimeout(idle);
    closeSync(out);
    closeSync(err);
    finish(dir, exitCode, failure, answered);
  };

  child.on('error', (error) => settle(null, `The agent could not be started: ${error.message}`));
  child.on('exit', (code) => settle(code, null));
  // The prompt goes in through stdin, which is always a pipe here; without it
  // the agent would have nothing to do.
  const { stdin, stdout } = child;
  if (!stdin || !stdout) {
    child.kill();
    throw new Error('the agent was started without stdin and stdout pipes');
  }
  // The pipe closes early when the agent dies at once; the exit handler reports it.
  stdin.on('error', () => {});
  const close = (): void => {
    clearInterval(poll);
    clearTimeout(idle);
    if (!stdin.writableEnded) stdin.end();
  };
  const keepOpenMs = record.keepOpenMs ?? 0;

  // The first message of a new conversation is the task as the user wrote it
  // (the prompt adds the framing and, in pack mode, the summary).
  let conversationExists = false;
  try {
    conversationExists = statSync(join(dir, CONVERSATION_FILE)).size > 0;
  } catch {
    conversationExists = false;
  }
  if (!conversationExists) appendConversation(dir, 'you', record.task);
  stdin.write(userLine(readFileSync(join(dir, PROMPT_FILE), 'utf8')));

  const turn: Turn = { texts: [], afterHook: false };
  let turns = record.turns ?? 0;
  let cost = record.costUsd ?? 0;
  const onTurnEnd = (answer: string, result: Record<string, unknown>): void => {
    // Not kept open: the agent ends now, and its end reports it as before (one
    // report, with its worktree settled).
    if (keepOpenMs <= 0) {
      close();
      return;
    }
    turns += 1;
    answered = true;
    if (typeof result.total_cost_usd === 'number') cost = result.total_cost_usd;
    const current = updateAgentAt(dir, {
      state: 'waiting',
      summary: (result.is_error === true ? String(result.result ?? answer) : answer).slice(0, SUMMARY_LENGTH),
      agentSessionId: typeof result.session_id === 'string' ? result.session_id : (record.agentSessionId ?? null),
      costUsd: cost,
      turns,
    });
    // Its answer goes back to the session now, as each later one will.
    try {
      returnResult(current);
    } catch (error) {
      logEvent(dir, 'error', 'agent answer could not be returned to the queue', describeError(error));
    }
    clearTimeout(idle);
    idle = setTimeout(close, keepOpenMs);
  };
  createInterface({ input: stdout }).on('line', (line) => {
    writeSync(out, `${line}\n`);
    try {
      onOutput(dir, line, turn, onTurnEnd);
    } catch (error) {
      logEvent(dir, 'error', 'agent output could not be recorded', describeError(error));
    }
  });

  // What the user writes to the agent: handed over at once, while it works
  // (Claude Code delivers it after the current step) or while it waits.
  let offset = 0;
  try {
    offset = statSync(join(dir, INBOX_FILE)).size;
  } catch {
    offset = 0;
  }
  poll = setInterval(() => {
    try {
      const read = readInbox(dir, offset);
      offset = read.offset;
      for (const text of read.messages) {
        if (stdin.writableEnded) break;
        clearTimeout(idle);
        stdin.write(userLine(text));
        updateAgentAt(dir, { state: 'running' });
      }
    } catch (error) {
      logEvent(dir, 'error', 'agent inbox could not be read', describeError(error));
    }
  }, INBOX_POLL_MS);

  if (child.pid) updateAgentAt(dir, { state: 'running', pid: child.pid });
  // Asked to stop (POSIX): take the agent down too.
  process.on('SIGTERM', () => {
    child.kill('SIGTERM');
  });
}

/** Runs the supervisor for the agent folder given on the command line. */
function run(dir: string | undefined): void {
  if (dir === undefined) {
    logEvent(undefined, 'error', 'agent-runner failed', { message: 'no agent folder was given' });
    process.exitCode = 1;
    return;
  }
  try {
    main(dir);
  } catch (error) {
    logEvent(dir, 'error', 'agent-runner failed', describeError(error));
    try {
      finish(dir, null, `The agent could not be started: ${error instanceof Error ? error.message : String(error)}`);
    } catch (inner) {
      logEvent(dir, 'error', 'agent-runner could not record the failure', describeError(inner));
    }
    process.exitCode = 1;
  }
}

// Only as a program: importing this module (its helpers, in tests) starts nothing.
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) run(process.argv[2]);
