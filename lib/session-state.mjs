// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Small per-session flags that live next to the queue (state.json).
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const STATE_FILE = 'state.json';

/**
 * @typedef {object} SessionState
 * @property {boolean} releaseAtEnd Deliver the queue when the current turn ends.
 */

/** @type {SessionState} */
const DEFAULTS = Object.freeze({ releaseAtEnd: false });

/**
 * @param {string} dir Session folder.
 * @returns {SessionState}
 */
export function readState(dir) {
  const file = join(dir, STATE_FILE);
  if (!existsSync(file)) return { ...DEFAULTS };
  try {
    const stored = JSON.parse(readFileSync(file, 'utf8'));
    return { releaseAtEnd: stored?.releaseAtEnd === true };
  } catch (error) {
    // An unreadable state file only means "no flags set": the queue itself is
    // untouched, so falling back to the defaults loses nothing.
    if (error instanceof SyntaxError) return { ...DEFAULTS };
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
  const file = join(dir, STATE_FILE);
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(next)}\n`);
  renameSync(temporary, file);
  return next;
}
