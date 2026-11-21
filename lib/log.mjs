// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Append-only JSON log in the data directory. Message texts are never logged.
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @param {string | undefined} dataDir
 * @param {'info' | 'warn' | 'error'} level
 * @param {string} event
 * @param {Record<string, unknown>} [details]
 */
export function logEvent(dataDir, level, event, details = {}) {
  const line = `${JSON.stringify({ t: new Date().toISOString(), level, event, ...details })}\n`;
  try {
    if (!dataDir) throw new Error('no data directory');
    mkdirSync(dataDir, { recursive: true });
    appendFileSync(join(dataDir, 'cmc.log'), line);
  } catch {
    // The log is the last resort; when it cannot be written the line goes to
    // stderr, which Claude Code keeps in its own debug output.
    process.stderr.write(`cmc: ${line}`);
  }
}

/** Reduces an error to what is safe and useful to log. */
export function describeError(error) {
  return error instanceof Error
    ? { name: error.name, code: error.code, message: error.message, stack: error.stack }
    : { message: String(error) };
}
