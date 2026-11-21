// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Replaces a file in one step: the new content goes to a temporary file next
// to it, which is then renamed over the target. A reader sees the old file or
// the new one, never half of either.
import { renameSync, rmSync, writeFileSync } from 'node:fs';

// On Windows a rename over a file that another process has open (the held
// messages indicator, an antivirus scan) fails for a moment with one of these.
// On POSIX a rename does not care who has the target open, so the same codes
// mean a real problem and are not retried.
const TRANSIENT_ON_WINDOWS = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RENAME_ATTEMPTS = 10;
const RENAME_FIRST_DELAY_MS = 10;
const RENAME_MAX_DELAY_MS = 200;

/** Blocks the thread for a while (the core is synchronous on purpose). */
export function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * @param {string} file Target path.
 * @param {string} content
 * @param {{ rename?: typeof renameSync, platform?: string, wait?: (ms: number) => void }} [options]
 *   Only for tests: the rename to use, the platform to behave as, and how to wait between attempts.
 */
export function writeFileAtomic(file, content, { rename = renameSync, platform = process.platform, wait = sleep } = {}) {
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, content);
    let delay = RENAME_FIRST_DELAY_MS;
    for (let attempt = 1; ; attempt += 1) {
      try {
        rename(temporary, file);
        return;
      } catch (error) {
        const transient = platform === 'win32' && TRANSIENT_ON_WINDOWS.has(error.code);
        if (!transient || attempt >= RENAME_ATTEMPTS) throw error;
        wait(delay);
        delay = Math.min(delay * 2, RENAME_MAX_DELAY_MS);
      }
    }
  } catch (error) {
    // The target is untouched; do not leave the temporary file behind.
    rmSync(temporary, { force: true });
    throw error;
  }
}
