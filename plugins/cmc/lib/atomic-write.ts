// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Replaces a file in one step: the new content goes to a temporary file next
// to it, which is then renamed over the target. A reader sees the old file or
// the new one, never half of either.
import { renameSync, rmSync, writeFileSync } from 'node:fs';
import { errorCode } from './errors.ts';

// On Windows a rename over a file that another process has open (the held
// messages indicator, an antivirus scan) fails for a moment with one of these.
// On POSIX a rename does not care who has the target open, so the same codes
// mean a real problem and are not retried.
const TRANSIENT_ON_WINDOWS: ReadonlySet<string> = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RENAME_ATTEMPTS = 10;
const RENAME_FIRST_DELAY_MS = 10;
const RENAME_MAX_DELAY_MS = 200;

/** Only for tests: the rename to use, the platform to behave as, and how to wait between attempts. */
export interface AtomicWriteOptions {
  rename?: (from: string, to: string) => void;
  platform?: string;
  wait?: (ms: number) => void;
}

/** Blocks the thread for a while (the core is synchronous on purpose). */
export function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * @param file Target path.
 */
export function writeFileAtomic(
  file: string,
  content: string,
  { rename = renameSync, platform = process.platform, wait = sleep }: AtomicWriteOptions = {},
): void {
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    // Owner only: these files hold what the user typed.
    writeFileSync(temporary, content, { mode: 0o600 });
    let delay = RENAME_FIRST_DELAY_MS;
    for (let attempt = 1; ; attempt += 1) {
      try {
        rename(temporary, file);
        return;
      } catch (error) {
        const code = errorCode(error);
        const transient = platform === 'win32' && code !== undefined && TRANSIENT_ON_WINDOWS.has(code);
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
