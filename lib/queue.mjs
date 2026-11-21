// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// The held-message queue of one session: a JSONL file, one message per line.
//
// Every operation runs under a lock directory and rewrites the file through a
// temporary file and a rename, so a message is never lost and never handed out
// twice, even when a hook and the CLI touch the queue at the same moment.
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CmcError } from './errors.mjs';

const QUEUE_FILE = 'queue.jsonl';
const LOCK_DIR = 'queue.lock';
const LOCK_TIMEOUT_MS = 5000;
const LOCK_STALE_MS = 10000;
const LOCK_RETRY_MS = 15;

export const MAX_TEXT_LENGTH = 20000;

/**
 * @typedef {object} HeldMessage
 * @property {string} id
 * @property {string} text
 * @property {string} at ISO timestamp of the moment it was held.
 * @property {string} source `user`, or the origin of a message cmc queued itself.
 */

/**
 * @typedef {object} QueueResult
 * @property {HeldMessage[]} messages
 * @property {string} [warning] Set when a damaged queue file had to be repaired.
 */

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withLock(dir, action) {
  const lock = join(dir, LOCK_DIR);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST' && error.code !== 'EPERM') throw error;
      if (isStale(lock)) {
        rmSync(lock, { recursive: true, force: true });
      } else if (Date.now() > deadline) {
        throw new CmcError('QUEUE_BUSY', 'The cmc queue is busy. Try again in a moment.');
      } else {
        sleep(LOCK_RETRY_MS);
      }
    }
  }
  try {
    return action();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

function isStale(lock) {
  try {
    return Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS;
  } catch {
    return false; // Released between the failed mkdir and this check.
  }
}

function isMessage(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.id === 'string' &&
    typeof value.text === 'string' &&
    typeof value.at === 'string' &&
    typeof value.source === 'string'
  );
}

function parseLine(line) {
  try {
    const value = JSON.parse(line);
    return isMessage(value) ? value : null;
  } catch {
    return null;
  }
}

/** Reads the queue. Caller holds the lock. */
function read(dir) {
  const file = join(dir, QUEUE_FILE);
  if (!existsSync(file)) return { messages: [] };

  const lines = readFileSync(file, 'utf8').split('\n').filter((line) => line.trim() !== '');
  const parsed = lines.map(parseLine);
  const messages = parsed.filter((message) => message !== null);
  const damaged = parsed.length - messages.length;
  if (damaged === 0) return { messages };

  // Keep what can be read, set the original aside, and say so.
  const aside = `queue.corrupt-${Date.now()}.jsonl`;
  copyFileSync(file, join(dir, aside));
  write(dir, messages);
  return {
    messages,
    warning: `The cmc queue file was damaged: ${messages.length} message(s) kept, ${damaged} unreadable line(s) set aside in ${aside}.`,
  };
}

/** Replaces the queue atomically. Caller holds the lock. */
function write(dir, messages) {
  const file = join(dir, QUEUE_FILE);
  const temporary = join(dir, `${QUEUE_FILE}.${process.pid}.tmp`);
  writeFileSync(temporary, messages.map((message) => `${JSON.stringify(message)}\n`).join(''));
  renameSync(temporary, file);
}

/**
 * Holds one message at the end of the queue.
 * @param {string} dir Session folder.
 * @param {{ text: string, source?: string }} input
 * @returns {QueueResult & { message: HeldMessage }}
 */
export function addMessage(dir, { text, source = 'user' }) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new CmcError('EMPTY_MESSAGE', 'There is no text to hold.');
  }
  if (text.length > MAX_TEXT_LENGTH) {
    throw new CmcError('MESSAGE_TOO_LONG', `A held message can be at most ${MAX_TEXT_LENGTH} characters long.`);
  }
  return withLock(dir, () => {
    const current = read(dir);
    const message = { id: randomUUID().slice(0, 8), text: text.trim(), at: new Date().toISOString(), source };
    const messages = [...current.messages, message];
    write(dir, messages);
    return { ...current, messages, message };
  });
}

/**
 * Lists the held messages in delivery order.
 * @param {string} dir Session folder.
 * @returns {QueueResult}
 */
export function listMessages(dir) {
  return withLock(dir, () => read(dir));
}

/**
 * Takes messages out of the queue: all of them, or only the given ids.
 * A message is returned by exactly one call, whoever asks first.
 * @param {string} dir Session folder.
 * @param {string[]} [ids]
 * @returns {QueueResult & { remaining: number }}
 */
export function drainMessages(dir, ids) {
  return withLock(dir, () => {
    const current = read(dir);
    const wanted = ids === undefined ? null : new Set(ids);
    const taken = current.messages.filter((message) => wanted === null || wanted.has(message.id));
    const kept = current.messages.filter((message) => wanted !== null && !wanted.has(message.id));
    if (taken.length > 0) write(dir, kept);
    return { ...current, messages: taken, remaining: kept.length };
  });
}
