// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Registry of the agents dispatched from one session: a folder per agent
// under the session folder, with its record, its prompt and its log.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomic } from './atomic-write.mjs';
import { CmcError } from './errors.mjs';

const AGENTS_DIR = 'agents';
const RECORD_FILE = 'agent.json';
const AGENT_ID = /^[a-f0-9]{8}$/;

export const PROMPT_FILE = 'prompt.txt';
export const OUTPUT_FILE = 'output.jsonl';
export const STDERR_FILE = 'stderr.log';

/**
 * @typedef {'starting' | 'running' | 'finished' | 'failed' | 'cancelled' | 'lost'} AgentState
 * `lost`: recorded as running, but its process is gone and it left no result.
 */

/**
 * @typedef {object} AgentRecord
 * @property {string} id
 * @property {string} task What the user asked for.
 * @property {AgentState} state
 * @property {'fork' | 'pack'} mode How it got its context.
 * @property {string} cwd Folder it was started in.
 * @property {string | null} worktree Name of its git worktree, if it has one.
 * @property {string[]} command Executable and arguments, as an array.
 * @property {number | null} runnerPid Process that supervises the agent.
 * @property {number | null} pid The agent process itself.
 * @property {string} startedAt
 * @property {string | null} endedAt
 * @property {number | null} exitCode
 * @property {string | null} summary Final answer of the agent, or why it failed.
 * @property {string} dir Agent folder (not stored; filled in when read).
 */

/** Whether a process with this pid exists. */
export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists but belongs to someone else.
    return error.code === 'EPERM';
  }
}

/**
 * @param {string} sessionDir
 * @param {string} id
 * @returns {string} The agent's folder.
 */
export function agentDir(sessionDir, id) {
  if (typeof id !== 'string' || !AGENT_ID.test(id)) throw new CmcError('NO_SUCH_AGENT', `There is no dispatched agent "${id}".`);
  return join(sessionDir, AGENTS_DIR, id);
}

/**
 * Creates the folder and the record of a new agent.
 * @param {string} sessionDir
 * @param {Omit<AgentRecord, 'id' | 'dir' | 'state' | 'runnerPid' | 'pid' | 'startedAt' | 'endedAt' | 'exitCode' | 'summary'>} fields
 * @param {string} [id] Chosen beforehand when other fields are derived from it.
 * @returns {AgentRecord}
 */
export function createAgent(sessionDir, fields, id = newAgentId()) {
  const dir = agentDir(sessionDir, id);
  mkdirSync(dir, { recursive: true });
  const record = {
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
  return { ...record, dir };
}

/** @returns {string} A new agent id: eight hex characters. */
export function newAgentId() {
  return randomBytes(4).toString('hex');
}

/**
 * Reads an agent record from its folder.
 * @param {string} dir Agent folder.
 * @returns {AgentRecord | null} `null` when there is no readable record.
 */
export function readAgentAt(dir) {
  try {
    const stored = JSON.parse(readFileSync(join(dir, RECORD_FILE), 'utf8'));
    return typeof stored?.id === 'string' ? { ...stored, dir } : null;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error instanceof SyntaxError) return null;
    throw error;
  }
}

/**
 * @param {string} dir Agent folder.
 * @param {Partial<AgentRecord>} patch
 * @returns {AgentRecord}
 */
export function updateAgentAt(dir, patch) {
  const current = readAgentAt(dir);
  if (!current) throw new CmcError('NO_SUCH_AGENT', 'The record of that dispatched agent is gone.');
  const { dir: _dir, ...stored } = { ...current, ...patch };
  writeFileAtomic(join(dir, RECORD_FILE), `${JSON.stringify(stored)}\n`);
  return { ...stored, dir };
}

/** An agent recorded as active whose processes are gone did not end well. */
function withLiveness(record) {
  const active = record.state === 'starting' || record.state === 'running';
  if (!active || isAlive(record.runnerPid) || isAlive(record.pid)) return record;
  return { ...record, state: 'lost' };
}

/**
 * @param {string} sessionDir
 * @param {string} id An agent id, or the start of one.
 * @returns {AgentRecord}
 */
export function findAgent(sessionDir, id) {
  const matches = listAgents(sessionDir).filter((record) => typeof id === 'string' && id !== '' && record.id.startsWith(id));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new CmcError('AMBIGUOUS_AGENT', `Several dispatched agents start with "${id}". Type more of the id.`);
  throw new CmcError('NO_SUCH_AGENT', `There is no dispatched agent "${id}".`);
}

/**
 * @param {string} sessionDir
 * @returns {AgentRecord[]} Every agent dispatched from the session, oldest first.
 */
export function listAgents(sessionDir) {
  const root = join(sessionDir, AGENTS_DIR);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => AGENT_ID.test(name))
    .map((name) => readAgentAt(join(root, name)))
    .filter((record) => record !== null)
    .map(withLiveness)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}
