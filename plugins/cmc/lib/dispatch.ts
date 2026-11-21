// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Starts a second agent for a task, without blocking or disturbing the
// session it is dispatched from (ADR 002).
//
// The user's text never becomes part of a command line: it is written to a
// file in the agent's folder and fed to the agent through stdin.
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentDir, createAgent, findAgent, isAlive, newAgentId, PROMPT_FILE, readAgentAt, updateAgentAt } from './agents-registry.ts';
import { CmcError } from './errors.ts';
import { MAX_TEXT_LENGTH } from './queue.ts';

const RUNNER = join(dirname(fileURLToPath(import.meta.url)), 'agent-runner.ts');

export const DEFAULT_PERMISSION_MODE = 'acceptEdits';
// Read and edit files; no shell, no network, unless the user configures more.
export const DEFAULT_TOOLS = Object.freeze(['Read', 'Glob', 'Grep', 'Edit', 'Write']);
// What a dispatched agent may run with. `bypassPermissions` is never accepted.
const PERMISSION_MODES = new Set(['default', 'acceptEdits', 'plan']);
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_]*(\([^()]*\))?$/;

/**
 * The prompt of a dispatched agent that forked the session.
 * @param {string} task
 * @returns {string}
 */
export function forkPrompt(task) {
  return [
    '[cmc] You are a second agent. The user dispatched you from the conversation above to work in parallel with it.',
    'The original agent is still running and keeps its own task: do not continue or repeat its work, and treat the',
    'last tool call you can see as possibly still running there.',
    '',
    'Your task, from the user:',
    task,
    '',
    'When you are done, end with a short summary of what you did and which files you changed.',
  ].join('\n');
}

/**
 * Builds the command line of a dispatched agent. Every value is one element
 * of the array; nothing is joined into a shell string.
 * @param {object} options
 * @param {string[]} options.claude Executable (and fixed leading arguments, in tests).
 * @param {'fork' | 'pack'} options.mode
 * @param {string} options.sessionId Session to fork (fork mode).
 * @param {string | null} options.worktree
 * @param {string} options.permissionMode
 * @param {readonly string[]} options.tools
 * @returns {string[]}
 */
export function buildCommand({ claude, mode, sessionId, worktree, permissionMode, tools }) {
  if (!PERMISSION_MODES.has(permissionMode)) {
    throw new CmcError('BAD_PERMISSION_MODE', `A dispatched agent cannot run with permission mode "${permissionMode}".`);
  }
  const badTool = tools.find((tool) => typeof tool !== 'string' || !TOOL_NAME.test(tool));
  if (badTool !== undefined) throw new CmcError('BAD_TOOL', `"${badTool}" is not a tool name a dispatched agent can be given.`);

  const command = [...claude, '-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', permissionMode];
  if (tools.length > 0) command.push('--allowedTools', tools.join(','));
  if (mode === 'fork') command.push('--resume', sessionId, '--fork-session');
  if (worktree) command.push('--worktree', worktree);
  return command;
}

/**
 * Dispatches a task to a new agent and returns at once; the agent runs under
 * a detached supervisor process that records how it ends.
 * @param {object} options
 * @param {string} options.sessionDir Folder of the session it is dispatched from.
 * @param {string} options.sessionId
 * @param {string} options.task
 * @param {string} options.cwd Folder the agent starts in.
 * @param {'fork' | 'pack'} [options.mode]
 * @param {string} [options.prompt] Full prompt; by default the fork prompt for the task.
 * @param {string | null} [options.worktree]
 * @param {string} [options.permissionMode]
 * @param {readonly string[]} [options.tools]
 * @param {string[]} [options.claude]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {import('./agents-registry.ts').AgentRecord}
 */
export function dispatch({
  sessionDir,
  sessionId,
  task,
  cwd,
  mode = 'fork',
  prompt,
  worktree = null,
  permissionMode = DEFAULT_PERMISSION_MODE,
  tools = DEFAULT_TOOLS,
  claude = [process.env.CMC_CLAUDE_BIN || 'claude'],
  env = process.env,
}) {
  if (typeof task !== 'string' || task.trim() === '') throw new CmcError('EMPTY_TASK', 'There is no task to dispatch.');
  if (task.length > MAX_TEXT_LENGTH) {
    throw new CmcError('TASK_TOO_LONG', `A dispatched task can be at most ${MAX_TEXT_LENGTH} characters long.`);
  }
  const id = newAgentId();
  const worktreeName = typeof worktree === 'function' ? worktree(id) : worktree;
  const command = buildCommand({ claude, mode, sessionId, worktree: worktreeName, permissionMode, tools });
  const record = createAgent(sessionDir, { task: task.trim(), mode, cwd, worktree: worktreeName, command }, id);
  writeFileSync(join(record.dir, PROMPT_FILE), prompt ?? forkPrompt(task.trim()));

  // The supervisor outlives this process (a hook that must return at once).
  const runner = spawn(process.execPath, [RUNNER, record.dir], { cwd, env, detached: true, stdio: 'ignore', windowsHide: true });
  runner.unref();
  return updateAgentAt(record.dir, { runnerPid: runner.pid ?? null });
}

/** Ends a process and everything it started. */
function killTree(pid) {
  if (!isAlive(pid)) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    return;
  }
  try {
    // The supervisor is detached, so it leads its own process group.
    process.kill(-pid, 'SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') process.kill(pid, 'SIGTERM');
  }
}

/**
 * Stops a dispatched agent.
 * @param {string} sessionDir
 * @param {string} id An agent id, or the start of one.
 * @returns {import('./agents-registry.ts').AgentRecord}
 */
export function cancelAgent(sessionDir, id) {
  const record = findAgent(sessionDir, id);
  if (record.state !== 'starting' && record.state !== 'running') {
    throw new CmcError('AGENT_NOT_RUNNING', `Agent ${record.id} is not running (${record.state}).`);
  }
  // Marked first, so the supervisor does not report the kill as a failure.
  updateAgentAt(record.dir, { state: 'cancelled', endedAt: new Date().toISOString() });
  killTree(record.runnerPid);
  killTree(record.pid);
  return readAgentAt(agentDir(sessionDir, record.id));
}
