// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// The held-message queue of one session: a JSONL file, one message per line.
//
// Every operation runs under a lock directory and rewrites the file through a
// temporary file and a rename, so a message is never lost and never handed out
// twice, even when a hook and the CLI touch the queue at the same moment.
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { sleep, writeFileAtomic } from './atomic-write.mjs';
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

/**
 * Whether a failed attempt to create the lock directory means "someone else
 * holds it". On Windows a directory that is being deleted answers `EPERM` for
 * a moment; anywhere else `EPERM` is a real permission error.
 * @param {{ code?: string }} error
 * @param {string} [platform]
 * @returns {boolean}
 */
export function isLockHeld(error, platform = process.platform) {
  return error.code === 'EEXIST' || (platform === 'win32' && error.code === 'EPERM');
}

// Removing the lock can fail for a moment on Windows (antivirus, a pending
// delete); a lock left behind would block the queue until it goes stale.
function removeLock(lock) {
  rmSync(lock, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}

function withLock(dir, action) {
  const lock = join(dir, LOCK_DIR);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if (!isLockHeld(error)) throw error;
      if (isStale(lock)) {
        removeLock(lock);
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
    removeLock(lock);
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
  writeFileAtomic(join(dir, QUEUE_FILE), messages.map((message) => `${JSON.stringify(message)}\n`).join(''));
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

function at(messages, position) {
  if (!Number.isInteger(position) || position < 1 || position > messages.length) {
    const size = messages.length === 0 ? 'nothing is held' : `the queue has ${messages.length}`;
    throw new CmcError('NO_SUCH_MESSAGE', `There is no held message ${position} (${size}).`);
  }
  return position - 1;
}

/**
 * Applies a change to the queue under the lock and saves the result.
 * @param {string} dir Session folder.
 * @param {(messages: HeldMessage[]) => HeldMessage[]} change Returns the new queue.
 * @returns {QueueResult}
 */
function mutate(dir, change) {
  return withLock(dir, () => {
    const current = read(dir);
    const messages = change([...current.messages]);
    write(dir, messages);
    return { ...current, messages };
  });
}

/**
 * Replaces the text of the message at a position (1 = delivered first).
 * @param {string} dir Session folder.
 * @param {number} position
 * @param {string} text
 * @returns {QueueResult}
 */
export function editMessage(dir, position, text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new CmcError('EMPTY_MESSAGE', 'There is no new text for the message.');
  }
  if (text.length > MAX_TEXT_LENGTH) {
    throw new CmcError('MESSAGE_TOO_LONG', `A held message can be at most ${MAX_TEXT_LENGTH} characters long.`);
  }
  return mutate(dir, (messages) => {
    const index = at(messages, position);
    messages[index] = { ...messages[index], text: text.trim() };
    return messages;
  });
}

/**
 * Deletes the messages at the given positions. Nothing is deleted unless every
 * position exists.
 * @param {string} dir Session folder.
 * @param {number[]} positions
 * @returns {QueueResult & { removed: HeldMessage[] }}
 */
export function removeMessages(dir, positions) {
  let removed = [];
  const result = mutate(dir, (messages) => {
    const indexes = new Set(positions.map((position) => at(messages, position)));
    removed = messages.filter((_, index) => indexes.has(index));
    return messages.filter((_, index) => !indexes.has(index));
  });
  return { ...result, removed };
}

/**
 * Deletes every held message.
 * @param {string} dir Session folder.
 * @returns {QueueResult & { removed: HeldMessage[] }}
 */
export function clearMessages(dir) {
  let removed = [];
  const result = mutate(dir, (messages) => {
    removed = messages;
    return [];
  });
  return { ...result, removed };
}

/**
 * Moves the message at one position to another; the rest keep their order.
 * @param {string} dir Session folder.
 * @param {number} from
 * @param {number} to
 * @returns {QueueResult}
 */
export function moveMessage(dir, from, to) {
  return mutate(dir, (messages) => {
    const source = at(messages, from);
    const target = at(messages, to);
    const [message] = messages.splice(source, 1);
    messages.splice(target, 0, message);
    return messages;
  });
}
