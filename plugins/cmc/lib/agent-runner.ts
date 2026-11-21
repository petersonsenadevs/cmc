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
import { describeError, logEvent } from './log.ts';

const SUMMARY_LENGTH = 4000;
const dir = process.argv[2];

/** The last `result` message of a stream-json log, if there is one. */
function lastResult(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!lines[i].includes('"result"')) continue;
    try {
      const message = JSON.parse(lines[i]);
      if (message.type === 'result') return message;
    } catch {
      // A line that is not JSON (a partial write, a stray warning) is not the result.
    }
  }
  return null;
}

function tail(file) {
  try {
    return readFileSync(file, 'utf8').trim().slice(-SUMMARY_LENGTH);
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

/** Records the end of the agent, unless the user already cancelled it. */
function finish(exitCode, failure) {
  const current = readAgentAt(dir);
  if (!current || current.state === 'cancelled') return;
  const result = lastResult(join(dir, OUTPUT_FILE));
  const succeeded = !failure && exitCode === 0 && result !== null && result.is_error !== true;
  const summary = succeeded
    ? String(result.result ?? '').slice(0, SUMMARY_LENGTH)
    : failure || String(result?.result ?? '').slice(0, SUMMARY_LENGTH) || tail(join(dir, STDERR_FILE)) || `The agent exited with code ${exitCode} and left no result.`;
  updateAgentAt(dir, {
    state: succeeded ? 'finished' : 'failed',
    endedAt: new Date().toISOString(),
    exitCode,
    summary,
    agentSessionId: result?.session_id ?? null,
    costUsd: typeof result?.total_cost_usd === 'number' ? result.total_cost_usd : null,
  });
}

function main() {
  const record = readAgentAt(dir);
  if (!record) throw new Error(`no agent record in ${dir}`);
  if (record.state === 'cancelled') return;

  const out = openSync(join(dir, OUTPUT_FILE), 'a');
  const err = openSync(join(dir, STDERR_FILE), 'a');
  const [executable, ...args] = record.command;
  const child = spawn(executable, args, { cwd: record.cwd, stdio: ['pipe', out, err], windowsHide: true });
  let settled = false;
  const settle = (exitCode, failure) => {
    if (settled) return;
    settled = true;
    closeSync(out);
    closeSync(err);
    finish(exitCode, failure);
  };

  child.on('error', (error) => settle(null, `The agent could not be started: ${error.message}`));
  child.on('exit', (code) => settle(code, null));
  // The pipe closes early when the agent dies at once; the exit handler reports it.
  child.stdin.on('error', () => {});
  child.stdin.end(readFileSync(join(dir, PROMPT_FILE), 'utf8'));

  if (child.pid) updateAgentAt(dir, { state: 'running', pid: child.pid });
  // Asked to stop (POSIX): take the agent down too.
  process.on('SIGTERM', () => {
    child.kill('SIGTERM');
  });
}

try {
  main();
} catch (error) {
  logEvent(dir, 'error', 'agent-runner failed', describeError(error));
  try {
    finish(null, `The agent could not be started: ${error.message}`);
  } catch (inner) {
    logEvent(dir, 'error', 'agent-runner could not record the failure', describeError(inner));
  }
  process.exitCode = 1;
}
