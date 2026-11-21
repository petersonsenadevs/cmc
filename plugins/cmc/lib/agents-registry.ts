// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Registry of the agents dispatched from one session: a folder per agent
// under the session folder, with its record, its prompt and its log.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { writeFileAtomic } from './atomic-write.ts';
import { CmcError, errorCode } from './errors.ts';
import { isRecord } from './types.ts';

const AGENTS_DIR = 'agents';
const RECORD_FILE = 'agent.json';
const ACTIVE_FILE = 'active.json';
const AGENT_ID = /^[a-f0-9]{8}$/;

export const PROMPT_FILE = 'prompt.txt';
export const OUTPUT_FILE = 'output.jsonl';
export const STDERR_FILE = 'stderr.log';

/** `lost`: recorded as running, but its process is gone and it left no result. */
export type AgentState = 'starting' | 'running' | 'finished' | 'failed' | 'cancelled' | 'lost';

/** How a dispatched agent got its context. */
export type AgentMode = 'fork' | 'pack';

/** How the result of a dispatched agent comes back to the session. */
export type ReturnMode = 'held' | 'auto';

export interface AgentRecord {
  id: string;
  /** What the user asked for. */
  task: string;
  state: AgentState;
  /** How it got its context. */
  mode: AgentMode;
  /** Folder it was started in. */
  cwd: string;
  /** Name of its git worktree, if it has one. */
  worktree: string | null;
  /**
   * How its result comes back to the session: held in the queue until the user
   * releases it (the default), or handed over by itself when a turn ends.
   */
  returnMode?: ReturnMode;
  /** Id of the held message that carries its result, once it has ended. */
  resultMessageId?: string;
  /** Pack mode only: why the summary of the session could not be built, if it could not. */
  contextWarning?: string | null;
  /** Commit the repository was on when the agent started (agents with a worktree). */
  baseCommit?: string | null;
  /** Branch of the worktree; set once the agent has ended. */
  branch?: string | null;
  /** Folder of the worktree when it was kept because the agent changed something. */
  worktreePath?: string | null;
  /** Files the agent changed in its worktree. */
  changedFiles?: string[];
  /** Executable and arguments, as an array. */
  command: string[];
  /** Process that supervises the agent. */
  runnerPid: number | null;
  /** The agent process itself. */
  pid: number | null;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  /** Final answer of the agent, or why it failed. */
  summary: string | null;
  /** Claude Code session the agent ran as; set by the supervisor when it ends. */
  agentSessionId?: string | null;
  /** What the run cost, when the agent reported it; set by the supervisor when it ends. */
  costUsd?: number | null;
  /** Agent folder (not stored; filled in when read). */
  dir: string;
}

/** What the caller decides about a new agent; the rest of the record starts empty. */
export type NewAgentFields = Pick<AgentRecord, 'task' | 'mode' | 'cwd' | 'worktree' | 'command' | 'baseCommit' | 'contextWarning' | 'returnMode'>;

/** Whether a process with this pid exists. */
export function isAlive(pid: unknown): boolean {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists but belongs to someone else.
    return errorCode(error) === 'EPERM';
  }
}

/**
 * @returns The agent's folder.
 */
export function agentDir(sessionDir: string, id: string): string {
  if (typeof id !== 'string' || !AGENT_ID.test(id)) throw new CmcError('NO_SUCH_AGENT', `There is no dispatched agent "${id}".`);
  return join(sessionDir, AGENTS_DIR, id);
}

/**
 * Creates the folder and the record of a new agent.
 * @param id Chosen beforehand when other fields are derived from it.
 */
export function createAgent(sessionDir: string, fields: NewAgentFields, id: string = newAgentId()): AgentRecord {
  const dir = agentDir(sessionDir, id);
  mkdirSync(dir, { recursive: true });
  const record: Omit<AgentRecord, 'dir'> = {
    id,
    ...fields,
    state: 'starting',
    runnerPid: null,
    pid: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    exitCode: null,
    summary: null,
  };
  writeFileAtomic(join(dir, RECORD_FILE), `${JSON.stringify(record)}\n`);
  noteActiveAgents(sessionDir);
  return { ...record, dir };
}

/**
 * Keeps `agents/active.json` in step with the records: the number of agents
 * still working. The indicator reads this one small file instead of every
 * record (it runs inside Claude Code's engine and cannot list a folder).
 */
export function noteActiveAgents(sessionDir: string): void {
  const active = listAgents(sessionDir).filter((agent) => agent.state === 'starting' || agent.state === 'running').length;
  writeFileAtomic(join(sessionDir, AGENTS_DIR, ACTIVE_FILE), `${JSON.stringify({ active })}\n`);
}

/** @returns A new agent id: eight hex characters. */
export function newAgentId(): string {
  return randomBytes(4).toString('hex');
}

/**
 * Reads an agent record from its folder.
 * @param dir Agent folder.
 * @returns `null` when there is no readable record.
 */
export function readAgentAt(dir: string): AgentRecord | null {
  try {
    const stored: unknown = JSON.parse(readFileSync(join(dir, RECORD_FILE), 'utf8'));
    if (!isRecord(stored) || typeof stored.id !== 'string') return null;
    // Only the id is checked: agent.json is written by this module alone
    // (createAgent, updateAgentAt), always with the whole record.
    return { ...stored, dir } as AgentRecord;
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ENOENT' || code === 'ENOTDIR' || error instanceof SyntaxError) return null;
    throw error;
  }
}

/**
 * @param dir Agent folder.
 */
export function updateAgentAt(dir: string, patch: Partial<AgentRecord>): AgentRecord {
  const current = readAgentAt(dir);
  if (!current) throw new CmcError('NO_SUCH_AGENT', 'The record of that dispatched agent is gone.');
  const { dir: _dir, ...stored } = { ...current, ...patch };
  writeFileAtomic(join(dir, RECORD_FILE), `${JSON.stringify(stored)}\n`);
  // The agent folder is <session>/agents/<id>.
  if (patch.state !== undefined) noteActiveAgents(dirname(dirname(dir)));
  return { ...stored, dir };
}

/** An agent recorded as active whose processes are gone did not end well. */
function withLiveness(record: AgentRecord): AgentRecord {
  const active = record.state === 'starting' || record.state === 'running';
  if (!active || isAlive(record.runnerPid) || isAlive(record.pid)) return record;
  return { ...record, state: 'lost' };
}

/**
 * @param id An agent id, or the start of one.
 */
export function findAgent(sessionDir: string, id: string): AgentRecord {
  const matches = listAgents(sessionDir).filter((record) => typeof id === 'string' && id !== '' && record.id.startsWith(id));
  const [match] = matches;
  if (matches.length === 1 && match) return match;
  if (matches.length > 1) throw new CmcError('AMBIGUOUS_AGENT', `Several dispatched agents start with "${id}". Type more of the id.`);
  throw new CmcError('NO_SUCH_AGENT', `There is no dispatched agent "${id}".`);
}

/**
 * @returns Every agent dispatched from the session, oldest first.
 */
export function listAgents(sessionDir: string): AgentRecord[] {
  const root = join(sessionDir, AGENTS_DIR);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => AGENT_ID.test(name))
    .map((name) => readAgentAt(join(root, name)))
    .filter((record) => record !== null)
    .map(withLiveness)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}
