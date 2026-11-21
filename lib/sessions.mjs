// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Registry of the Claude Code sessions that have cmc loaded, so the command
// line can find "the session running in this folder" from another terminal.
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { CmcError } from './errors.mjs';
import { sessionDir } from './paths.mjs';
import { listMessages } from './queue.mjs';

const SESSION_FILE = 'session.json';
// Marks a plugin data directory as cmc's, whatever name Claude Code gave it.
const MARKER_FILE = 'cmc.json';

export const DEFAULT_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
// Only folders named like a session id are ever deleted.
const SESSION_FOLDER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/**
 * @typedef {object} SessionRecord
 * @property {string} id
 * @property {string} cwd Folder the session was started in.
 * @property {string} startedAt ISO timestamp.
 * @property {string} lastActiveAt ISO timestamp of the last start or end of turn.
 * @property {string | null} endedAt ISO timestamp, once the session was closed.
 * @property {string} dir Session folder (not stored; filled in when read).
 */

function writeJson(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value)}\n`);
  renameSync(temporary, file);
}

function readRecord(dir) {
  try {
    const stored = JSON.parse(readFileSync(join(dir, SESSION_FILE), 'utf8'));
    if (typeof stored?.id !== 'string' || typeof stored?.cwd !== 'string') return null;
    return {
      id: stored.id,
      cwd: stored.cwd,
      startedAt: String(stored.startedAt ?? ''),
      lastActiveAt: String(stored.lastActiveAt ?? stored.startedAt ?? ''),
      endedAt: typeof stored.endedAt === 'string' ? stored.endedAt : null,
      dir,
    };
  } catch (error) {
    // No record, or one that cannot be read: the folder is not a known session.
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

function save(record) {
  const { dir, ...stored } = record;
  writeJson(join(dir, SESSION_FILE), stored);
}

/**
 * Handles a `SessionStart` hook call: records the session and its folder.
 * A resumed session keeps its original start time.
 * @param {{ session_id?: string, cwd?: string }} input
 * @param {{ dataDir: string }} context
 * @returns {{ systemMessage: string } | null} A reminder for the user when messages are still held.
 */
export function handleSessionStart(input, { dataDir, retentionDays = DEFAULT_RETENTION_DAYS }) {
  const dir = sessionDir(dataDir, input.session_id);
  const now = new Date().toISOString();
  const previous = readRecord(dir);
  writeJson(join(dataDir, MARKER_FILE), { plugin: 'cmc' });
  save({
    id: input.session_id,
    cwd: resolve(typeof input.cwd === 'string' && input.cwd !== '' ? input.cwd : process.cwd()),
    startedAt: previous?.startedAt || now,
    lastActiveAt: now,
    endedAt: null,
    dir,
  });
  pruneSessions(dataDir, { maxAgeDays: retentionDays, keep: input.session_id });

  // A compaction restarts the context, not the session: the user has not left,
  // and the indicator is still on screen, so there is nothing to remind them of.
  if (input.source === 'compact') return null;
  const held = listMessages(dir).messages.length;
  if (held === 0) return null;
  return { systemMessage: `cmc: ${held} held message(s) are waiting in this session. Type ;;list to see them.` };
}

/**
 * Deletes the folders of sessions that have been inactive for too long, with
 * whatever they still held.
 * @param {string} dataDir
 * @param {{ maxAgeDays: number, keep?: string, now?: number }} options `keep` is a session id never deleted.
 * @returns {string[]} Ids of the sessions removed.
 */
export function pruneSessions(dataDir, { maxAgeDays, keep, now = Date.now() }) {
  const root = join(dataDir, 'sessions');
  if (!existsSync(root) || !(maxAgeDays > 0)) return [];
  const removed = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !SESSION_FOLDER.test(entry.name) || entry.name === keep) continue;
    const dir = join(root, entry.name);
    const record = readRecord(dir);
    // Without a readable record, the folder's own age stands in for the last activity.
    const lastActive = Date.parse(record?.lastActiveAt ?? '') || statSync(dir).mtimeMs;
    if (now - lastActive > maxAgeDays * DAY_MS) {
      rmSync(dir, { recursive: true, force: true });
      removed.push(entry.name);
    }
  }
  return removed;
}

/**
 * Handles a `SessionEnd` hook call: the session stops being offered to the CLI.
 * Its queue stays on disk, so resuming the session finds it again.
 * @param {{ session_id?: string }} input
 * @param {{ dataDir: string }} context
 * @returns {null}
 */
export function handleSessionEnd(input, { dataDir }) {
  const record = readRecord(sessionDir(dataDir, input.session_id));
  if (record) save({ ...record, endedAt: new Date().toISOString() });
  return null;
}

/**
 * Notes that the session is alive (called when a turn ends).
 * @param {string} dir Session folder.
 */
export function touchSession(dir) {
  const record = readRecord(dir);
  if (record) save({ ...record, lastActiveAt: new Date().toISOString(), endedAt: null });
}

/**
 * The data directories the CLI should look in: the one it was told about, or
 * every plugin data directory that cmc has marked as its own.
 * @param {string} [explicit]
 * @returns {string[]}
 */
export function candidateDataDirs(explicit) {
  const given = [explicit, process.env.CMC_DATA_DIR, process.env.CLAUDE_PLUGIN_DATA].find(
    (value) => typeof value === 'string' && value.trim() !== '' && !value.includes('${'),
  );
  if (given) return [resolve(given)];

  const root = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'plugins', 'data');
  let names;
  try {
    names = readdirSync(root);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return names.map((name) => join(root, name)).filter((dir) => existsSync(join(dir, MARKER_FILE)));
}

/**
 * @param {string[]} dataDirs
 * @returns {SessionRecord[]} Every recorded session, most recently active first.
 */
export function listSessions(dataDirs) {
  const records = dataDirs.flatMap((dataDir) => {
    const root = join(dataDir, 'sessions');
    if (!existsSync(root)) return [];
    return readdirSync(root).map((name) => readRecord(join(root, name))).filter((record) => record !== null);
  });
  return records.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
}

function comparable(path) {
  const full = resolve(path);
  return process.platform === 'win32' ? full.toLowerCase() : full;
}

/**
 * Open sessions started in `cwd`, or failing that in the closest folder above it.
 * @param {SessionRecord[]} records
 * @param {string} cwd
 * @returns {SessionRecord[]}
 */
export function openSessionsIn(records, cwd) {
  const here = comparable(cwd);
  const open = records.filter((record) => record.endedAt === null);
  const exact = open.filter((record) => comparable(record.cwd) === here);
  if (exact.length > 0) return exact;

  const above = open.filter((record) => here.startsWith(comparable(record.cwd) + sep));
  const deepest = Math.max(0, ...above.map((record) => comparable(record.cwd).length));
  return above.filter((record) => comparable(record.cwd).length === deepest);
}

/**
 * Describes sessions in one line each, for the user to pick from.
 * @param {SessionRecord[]} records
 * @returns {string}
 */
export function formatSessions(records) {
  return records
    .map((record) => {
      const state = record.endedAt ? 'closed' : `last active ${record.lastActiveAt.replace('T', ' ').slice(0, 16)} UTC`;
      return `  ${record.id.slice(0, 8)}  ${state}  ${record.cwd}`;
    })
    .join('\n');
}

/**
 * Picks the session a CLI command is meant for.
 * @param {{ dataDirs: string[], cwd: string, wanted?: string }} query `wanted` is a session id or the start of one.
 * @returns {SessionRecord}
 */
export function resolveSession({ dataDirs, cwd, wanted }) {
  const records = listSessions(dataDirs);

  if (wanted) {
    const matches = records.filter((record) => record.id.startsWith(wanted));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new CmcError('AMBIGUOUS_SESSION', `Several sessions start with "${wanted}":\n${formatSessions(matches)}`);
    }
    throw new CmcError('NO_SESSION', `cmc knows no session "${wanted}".`);
  }

  const here = openSessionsIn(records, cwd);
  if (here.length === 1) return here[0];
  if (here.length === 0) {
    throw new CmcError(
      'NO_SESSION',
      `No open Claude Code session with cmc was started in ${resolve(cwd)}. Nothing was done.\n` +
        'Start one there, or name a session with --session <id> (see "cmc sessions --all").',
    );
  }
  throw new CmcError(
    'AMBIGUOUS_SESSION',
    `${here.length} open sessions were started in this folder. Nothing was done. Pick one with --session <id>:\n${formatSessions(here)}`,
  );
}
