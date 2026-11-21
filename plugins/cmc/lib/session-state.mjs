// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Small per-session flags that live next to the queue (state.json).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomic } from './atomic-write.mjs';

const STATE_FILE = 'state.json';

/**
 * Which held messages a pending release covers: nothing, the whole queue
 * (including what gets held later), or the messages with these ids.
 * @typedef {null | 'all' | string[]} Selection
 */

/**
 * @typedef {object} SessionState
 * @property {Selection} atEnd Deliver when the current turn ends.
 * @property {Selection} atNextStep Deliver at the agent's next step (armed from outside the session).
 */

function selection(value) {
  if (value === 'all') return 'all';
  if (Array.isArray(value) && value.length > 0 && value.every((id) => typeof id === 'string')) return value;
  return null;
}

/**
 * Adds a selection to one that is already pending.
 * @param {Selection} current
 * @param {Selection} added
 * @returns {Selection}
 */
export function mergeSelection(current, added) {
  if (current === 'all' || added === 'all') return 'all';
  const ids = [...(current ?? []), ...(added ?? [])];
  return ids.length > 0 ? [...new Set(ids)] : null;
}

/**
 * @param {string} dir Session folder.
 * @returns {SessionState}
 */
export function readState(dir) {
  const file = join(dir, STATE_FILE);
  if (!existsSync(file)) return { atEnd: null, atNextStep: null };
  try {
    const stored = JSON.parse(readFileSync(file, 'utf8'));
    return { atEnd: selection(stored?.atEnd), atNextStep: selection(stored?.atNextStep) };
  } catch (error) {
    // An unreadable state file only means "no release pending": the queue
    // itself is untouched, so falling back to the defaults loses nothing.
    if (error instanceof SyntaxError) return { atEnd: null, atNextStep: null };
    throw error;
  }
}

/**
 * @param {string} dir Session folder.
 * @param {Partial<SessionState>} patch
 * @returns {SessionState}
 */
export function updateState(dir, patch) {
  const next = { ...readState(dir), ...patch };
  writeFileAtomic(join(dir, STATE_FILE), `${JSON.stringify(next)}\n`);
  return next;
}
