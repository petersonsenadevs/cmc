// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// The shared shell of every hook script: read the JSON Claude Code sends on
// stdin, run a handler from the core, print its answer.
import { readSync } from 'node:fs';
import { sleep } from './atomic-write.mjs';
import { describeError, logEvent } from './log.mjs';
import { resolveDataDir } from './paths.mjs';

/**
 * Reads everything Claude Code wrote to stdin.
 *
 * `readFileSync(0)` is not used because it gives up where a plain read loop
 * does not: on POSIX a pipe left in non-blocking mode answers `EAGAIN` while
 * the writer is still busy, and on Windows a closed pipe can answer `EOF`
 * instead of a zero-length read. A hook that failed here would let a prompt
 * the user meant to hold through to the agent.
 * @returns {string}
 */
function readStdin() {
  const chunks = [];
  const buffer = Buffer.alloc(65536);
  for (;;) {
    let length;
    try {
      length = readSync(0, buffer, 0, buffer.length, null);
    } catch (error) {
      if (error.code === 'EAGAIN') {
        sleep(5);
        continue;
      }
      if (error.code === 'EOF') break;
      throw error;
    }
    if (length === 0) break;
    chunks.push(Buffer.from(buffer.subarray(0, length)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Runs a hook handler and never lets a failure of cmc get in the user's way:
 * on any error the hook prints nothing and exits 0, so Claude Code carries on
 * as if the plugin were not installed, and the error is logged.
 * @param {string} name Hook name for the log.
 * @param {(input: object, context: { dataDir: string }) => object | null} handler
 */
export function runHook(name, handler) {
  let dataDir;
  try {
    dataDir = resolveDataDir();
    const input = JSON.parse(readStdin());
    const output = handler(input, { dataDir });
    if (output) process.stdout.write(JSON.stringify(output));
  } catch (error) {
    logEvent(dataDir, 'error', `${name} failed`, describeError(error));
  }
}
