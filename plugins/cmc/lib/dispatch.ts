// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Starts a second agent for a task, without blocking or disturbing the
// session it is dispatched from (ADR 002).
//
// The user's text never becomes part of a command line: it is written to a
// file in the agent's folder and fed to the agent through stdin.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type ReturnMode,
  agentDir,
  appendConversation,
  appendInbox,
  createAgent,
  findAgent,
  isAlive,
  newAgentId,
  PROMPT_FILE,
  readAgentAt,
  updateAgentAt,
  type AgentMode,
  type AgentRecord,
} from './agents-registry.ts';
import { DEFAULT_CONFIG, EFFORTS, MODEL_NAME, PERMISSION_MODES, TOOL_NAME, loadConfig } from './config.ts';
import { buildContextPack, packPrompt } from './context-pack.ts';
import { CmcError, errorCode } from './errors.ts';
import { MAX_TEXT_LENGTH } from './queue.ts';
import { headCommit, isGitRepo, settleWorktree, worktreeName } from './worktree.ts';

const RUNNER = join(dirname(fileURLToPath(import.meta.url)), 'agent-runner.ts');

export const DEFAULT_PERMISSION_MODE = DEFAULT_CONFIG.dispatch.permissionMode;
// Read and edit files; no shell, no network, unless the user configures more.
export const DEFAULT_TOOLS: readonly string[] = DEFAULT_CONFIG.dispatch.tools;
// What a dispatched agent may run with. `bypassPermissions` is never accepted.

export interface BuildCommandOptions {
  /** Executable (and fixed leading arguments, in tests). */
  claude: readonly string[];
  mode: AgentMode;
  /** Session to fork (fork mode). */
  sessionId: string;
  worktree: string | null;
  permissionMode: string;
  tools: readonly string[];
  /** Give the agent only the built-in tools in `tools` (default), not merely pre-approve them. */
  restrictTools?: boolean;
  /** `--model`; `inherit` or absent passes none. */
  model?: string;
  /** `--effort`; `inherit` or absent passes none. */
  effort?: string;
}

export interface DispatchOptions {
  /** Folder of the session it is dispatched from. */
  sessionDir: string;
  sessionId: string;
  task: string;
  /** Folder the agent starts in. */
  cwd: string;
  mode?: AgentMode;
  /** How its result comes back: held in the queue (default) or handed over when a turn ends. */
  returnMode?: ReturnMode;
  /** Full prompt; by default the fork prompt for the task, or the pack prompt in pack mode. */
  prompt?: string;
  /** Transcript of the session (`transcript_path` of the hook input); read in pack mode. */
  transcriptPath?: string;
  /**
   * Git worktree the agent runs in. Left out, the agent gets its own worktree
   * (`cmc-<id>`) when the folder is a git repository, and works in the folder
   * itself when it is not. `null` turns the isolation off; a string or a
   * function of the agent id names the worktree.
   */
  worktree?: string | null | ((id: string) => string | null);
  permissionMode?: string;
  tools?: readonly string[];
  claude?: readonly string[];
  env?: NodeJS.ProcessEnv;
  restrictTools?: boolean;
  /** How long its session stays open for the user's messages after it answers, in ms; 0 (the default) closes it at once. */
  keepOpenMs?: number;
  model?: string;
  effort?: string;
}

/**
 * The prompt of a dispatched agent that forked the session.
 */
export function forkPrompt(task: string): string {
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
 */
export function buildCommand({ claude, mode, sessionId, worktree, permissionMode, tools, restrictTools = true, model, effort }: BuildCommandOptions): string[] {
  if (model !== undefined && !MODEL_NAME.test(model)) throw new CmcError('BAD_MODEL', `"${model}" is not a model name.`);
  if (effort !== undefined && !EFFORTS.includes(effort)) throw new CmcError('BAD_EFFORT', `"${effort}" is not an effort; use one of ${EFFORTS.join(', ')}.`);
  if (!PERMISSION_MODES.includes(permissionMode)) {
    throw new CmcError('BAD_PERMISSION_MODE', `A dispatched agent cannot run with permission mode "${permissionMode}".`);
  }
  const badTool = tools.find((tool) => typeof tool !== 'string' || !TOOL_NAME.test(tool));
  if (badTool !== undefined) throw new CmcError('BAD_TOOL', `"${badTool}" is not a tool name a dispatched agent can be given.`);

  // stream-json both ways: the supervisor keeps the input open, so the user can
  // write to the agent while it works and after it answers.
  const command = [...claude, '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-mode', permissionMode];
  // --tools limits the built-in tools the agent has at all, whatever the
  // project or user settings allow; --allowedTools pre-approves them.
  if (restrictTools) {
    const builtIn = [...new Set(tools.map((tool) => tool.replace(/\(.*$/, '')))];
    command.push('--tools', builtIn.join(','));
  }
  if (tools.length > 0) command.push('--allowedTools', tools.join(','));
  // Only what the user chose: "inherit" leaves it to their own Claude Code setup.
  if (model !== undefined && model !== 'inherit') command.push('--model', model);
  if (effort !== undefined && effort !== 'inherit') command.push('--effort', effort);
  if (mode === 'fork') command.push('--resume', sessionId, '--fork-session');
  if (worktree) command.push('--worktree', worktree);
  return command;
}

/**
 * Dispatches a task to a new agent and returns at once; the agent runs under
 * a detached supervisor process that records how it ends.
 */
export function dispatch({
  sessionDir,
  sessionId,
  task,
  cwd,
  mode = 'fork',
  returnMode = 'held',
  prompt,
  transcriptPath,
  worktree,
  permissionMode = DEFAULT_PERMISSION_MODE,
  tools = DEFAULT_TOOLS,
  restrictTools = true,
  claude = [process.env.CMC_CLAUDE_BIN || 'claude'],
  env = process.env,
  keepOpenMs = 0,
  model,
  effort,
}: DispatchOptions): AgentRecord {
  if (typeof task !== 'string' || task.trim() === '') throw new CmcError('EMPTY_TASK', 'There is no task to dispatch.');
  if (task.length > MAX_TEXT_LENGTH) {
    throw new CmcError('TASK_TOO_LONG', `A dispatched task can be at most ${MAX_TEXT_LENGTH} characters long.`);
  }
  const id = newAgentId();
  const repository = isGitRepo(cwd);
  // Without git there is no worktree: the agent shares the folder (the caller warns the user).
  const chosen = worktree === undefined ? (repository ? worktreeName(id) : null) : typeof worktree === 'function' ? worktree(id) : worktree;
  const worktreeOfAgent = repository ? chosen : null;
  const command = buildCommand({
    claude,
    mode,
    sessionId,
    worktree: worktreeOfAgent,
    permissionMode,
    tools,
    restrictTools,
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
  });
  const baseCommit = worktreeOfAgent === null ? null : headCommit(cwd);
  // A pack is a summary read from the transcript; when it cannot be read the
  // agent still starts, knowing only the task and the folder, and the record says why.
  const pack = mode === 'pack' && prompt === undefined ? buildContextPack(transcriptPath, cwd) : null;
  const text = prompt ?? (pack === null ? forkPrompt(task.trim()) : packPrompt(task.trim(), pack));
  const record = createAgent(
    sessionDir,
    { task: task.trim(), mode, returnMode, cwd, worktree: worktreeOfAgent, baseCommit, command, contextWarning: pack?.warning ?? null, keepOpenMs, model: model ?? 'inherit', effort: effort ?? 'inherit' },
    id,
  );
  writeFileSync(join(record.dir, PROMPT_FILE), text, { mode: 0o600 });

  return startRunner(record, cwd, env);
}

/** Starts the supervisor of an agent. It outlives this process (a hook that must return at once). */
function startRunner(record: AgentRecord, cwd: string, env: NodeJS.ProcessEnv): AgentRecord {
  const runner = spawn(process.execPath, [RUNNER, record.dir], { cwd, env, detached: true, stdio: 'ignore', windowsHide: true });
  runner.unref();
  return updateAgentAt(record.dir, { runnerPid: runner.pid ?? null });
}

/** The command that resumes an agent's own session: the same tools and permissions, without forking or a new worktree. */
export function resumeCommand(command: readonly string[], agentSessionId: string): string[] {
  const kept: string[] = [];
  for (let i = 0; i < command.length; i += 1) {
    const arg = command[i] ?? '';
    if (arg === '--resume' || arg === '--worktree') i += 1;
    else if (arg !== '--fork-session') kept.push(arg);
  }
  return [...kept, '--resume', agentSessionId];
}

/**
 * Writes to an agent. While its session is open (working, or waiting after an
 * answer) the message goes to its inbox, and its supervisor hands it over: a
 * working agent reads it after its current step. Once the session has closed,
 * it is resumed with the message, in the folder it worked in.
 * @returns The agent's record.
 */
export function tellAgent(sessionDir: string, id: string, text: string, env: NodeJS.ProcessEnv = process.env): AgentRecord {
  const message = typeof text === 'string' ? text.trim() : '';
  if (message === '') throw new CmcError('EMPTY_MESSAGE', 'There is nothing to send.');
  if (message.length > MAX_TEXT_LENGTH) throw new CmcError('MESSAGE_TOO_LONG', `A message can be at most ${MAX_TEXT_LENGTH} characters long.`);
  const record = findAgent(sessionDir, id);
  if (record.state === 'starting' || record.state === 'running' || record.state === 'waiting') {
    appendInbox(record.dir, message);
    appendConversation(record.dir, 'you', message);
    return record;
  }
  if (record.state === 'cancelled') throw new CmcError('AGENT_CANCELLED', `Agent ${record.id} was cancelled; start a new one instead.`);
  if (!record.agentSessionId) {
    throw new CmcError('AGENT_NO_SESSION', `Agent ${record.id} ${record.state} before it answered, so it has no session to resume.`);
  }
  const resumeCwd = record.worktreePath && existsSync(record.worktreePath) ? record.worktreePath : record.cwd;
  appendConversation(record.dir, 'you', message);
  writeFileSync(join(record.dir, PROMPT_FILE), message, { mode: 0o600 });
  const resumed = updateAgentAt(record.dir, {
    state: 'starting',
    command: resumeCommand(record.command, record.agentSessionId),
    resumeCwd,
    pid: null,
    endedAt: null,
    exitCode: null,
  });
  return startRunner(resumed, resumeCwd, env);
}

/**
 * Settles the worktree of an agent that has ended and notes the outcome in
 * its record: removed when the agent changed nothing, kept with its branch
 * and the list of changed files when it did.
 * @param dir Agent folder.
 * @param cwd Folder the agent was started in.
 */
export function recordWorktree(dir: string, cwd: string, worktree: string, baseCommit: string | null): AgentRecord {
  // The agent's folder is <data>/sessions/<session>/agents/<id>.
  const { config } = loadConfig(join(dir, '..', '..', '..', '..'));
  const outcome = settleWorktree(cwd, worktree, baseCommit, config.dispatch.ignoreChanges);
  return updateAgentAt(dir, { branch: outcome.kept ? outcome.branch : null, worktreePath: outcome.path, changedFiles: outcome.files });
}

/** Ends a process and everything it started. */
function killTree(pid: number | null): void {
  if (pid === null || !isAlive(pid)) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    return;
  }
  try {
    // The supervisor is detached, so it leads its own process group.
    process.kill(-pid, 'SIGTERM');
  } catch (error) {
    if (errorCode(error) === 'ESRCH') return;
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Gone meanwhile, or not ours to stop: nothing more to do.
    }
  }
}

/**
 * Stops a dispatched agent.
 * @param id An agent id, or the start of one.
 */
export function cancelAgent(sessionDir: string, id: string): AgentRecord {
  const record = findAgent(sessionDir, id);
  if (record.state !== 'starting' && record.state !== 'running' && record.state !== 'waiting') {
    throw new CmcError('AGENT_NOT_RUNNING', `Agent ${record.id} is not running (${record.state}).`);
  }
  // Marked first, so the supervisor does not report the kill as a failure.
  const cancelled = updateAgentAt(record.dir, { state: 'cancelled', endedAt: new Date().toISOString() });
  killTree(record.runnerPid);
  killTree(record.pid);
  // The supervisor may have been saving an answer while it was marked: with
  // its processes gone nothing writes any more, so the mark is made to stand.
  updateAgentAt(record.dir, { state: 'cancelled' });
  // The supervisor was killed with the agent, so its worktree is settled here.
  if (record.worktree !== null) recordWorktree(record.dir, record.cwd, record.worktree, record.baseCommit ?? null);
  // Read again for what the supervisor wrote meanwhile; if the record is gone, what was just saved stands.
  return readAgentAt(agentDir(sessionDir, record.id)) ?? cancelled;
}
