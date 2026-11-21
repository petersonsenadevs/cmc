#!/usr/bin/env node
// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Supervisor of one dispatched agent. It is started detached, so it outlives
// the hook that asked for the agent: it runs the agent, keeps its output in a
// log and records how it ended.
//
//   node agent-runner.ts <agentDir>
import { spawn } from 'node:child_process';
import { closeSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUTPUT_FILE, PROMPT_FILE, readAgentAt, STDERR_FILE, updateAgentAt } from './agents-registry.ts';
import { errorCode } from './errors.ts';
import { describeError, logEvent } from './log.ts';
import { isRecord } from './types.ts';

const SUMMARY_LENGTH = 4000;

/** The last `result` message of a stream-json log, if there is one. */
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

/** Records the end of the agent, unless the user already cancelled it. */
function finish(dir: string, exitCode: number | null, failure: string | null): void {
  const current = readAgentAt(dir);
  if (!current || current.state === 'cancelled') return;
  const result = lastResult(join(dir, OUTPUT_FILE));
  const succeeded = !failure && exitCode === 0 && result !== null && result.is_error !== true;
  const summary = succeeded
    ? String(result?.result ?? '').slice(0, SUMMARY_LENGTH)
    : failure || String(result?.result ?? '').slice(0, SUMMARY_LENGTH) || tail(join(dir, STDERR_FILE)) || `The agent exited with code ${exitCode} and left no result.`;
  updateAgentAt(dir, {
    state: succeeded ? 'finished' : 'failed',
    endedAt: new Date().toISOString(),
    exitCode,
    summary,
    agentSessionId: typeof result?.session_id === 'string' ? result.session_id : null,
    costUsd: typeof result?.total_cost_usd === 'number' ? result.total_cost_usd : null,
  });
}

function main(dir: string): void {
  const record = readAgentAt(dir);
  if (!record) throw new Error(`no agent record in ${dir}`);
  if (record.state === 'cancelled') return;

  const [executable, ...args] = record.command;
  if (executable === undefined) throw new Error('the agent record has no command to run');
  const out = openSync(join(dir, OUTPUT_FILE), 'a');
  const err = openSync(join(dir, STDERR_FILE), 'a');
  const child = spawn(executable, args, { cwd: record.cwd, stdio: ['pipe', out, err], windowsHide: true });
  let settled = false;
  const settle = (exitCode: number | null, failure: string | null): void => {
    if (settled) return;
    settled = true;
    closeSync(out);
    closeSync(err);
    finish(dir, exitCode, failure);
  };

  child.on('error', (error) => settle(null, `The agent could not be started: ${error.message}`));
  child.on('exit', (code) => settle(code, null));
  // The prompt goes in through stdin, which is always a pipe here; without it
  // the agent would have nothing to do.
  const { stdin } = child;
  if (!stdin) {
    child.kill();
    throw new Error('the agent was started without a stdin pipe');
  }
  // The pipe closes early when the agent dies at once; the exit handler reports it.
  stdin.on('error', () => {});
  stdin.end(readFileSync(join(dir, PROMPT_FILE), 'utf8'));

  if (child.pid) updateAgentAt(dir, { state: 'running', pid: child.pid });
  // Asked to stop (POSIX): take the agent down too.
  process.on('SIGTERM', () => {
    child.kill('SIGTERM');
  });
}

const dir = process.argv[2];
if (dir === undefined) {
  logEvent(undefined, 'error', 'agent-runner failed', { message: 'no agent folder was given' });
  process.exitCode = 1;
} else {
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
