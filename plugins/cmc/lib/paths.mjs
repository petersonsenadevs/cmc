// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Where the plugin keeps its state: always under the plugin data directory,
// never inside the plugin folder.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CmcError } from './errors.mjs';

// Session ids become folder names, so they are restricted to a safe alphabet.
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/**
 * Resolves the data directory from an explicit value or the environment
 * Claude Code gives to hook processes.
 * @param {string} [explicit]
 * @returns {string} Absolute path.
 */
export function resolveDataDir(explicit) {
  const candidate = [explicit, process.env.CLAUDE_PLUGIN_DATA].find(
    // An unexpanded "${CLAUDE_PLUGIN_DATA}" means the caller had no value to give.
    (value) => typeof value === 'string' && value.trim() !== '' && !value.includes('${'),
  );
  if (!candidate) {
    throw new CmcError('NO_DATA_DIR', 'cmc does not know where its data directory is (CLAUDE_PLUGIN_DATA is not set).');
  }
  return resolve(candidate);
}

/**
 * Returns the folder of one session, creating it if needed.
 * @param {string} dataDir
 * @param {string} sessionId
 * @returns {string}
 */
export function sessionDir(dataDir, sessionId) {
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) {
    throw new CmcError('BAD_SESSION_ID', 'cmc received a session id it cannot use as a folder name.');
  }
  const dir = join(dataDir, 'sessions', sessionId);
  mkdirSync(dir, { recursive: true });
  return dir;
}
