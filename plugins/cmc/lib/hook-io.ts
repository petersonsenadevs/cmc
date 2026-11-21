// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// The shared shell of every hook script: read the JSON Claude Code sends on
// stdin, run a handler from the core, print its answer.
import { readSync } from 'node:fs';
import { sleep } from './atomic-write.ts';
import { errorCode } from './errors.ts';
import { describeError, logEvent } from './log.ts';
import { resolveDataDir } from './paths.ts';
import { isRecord, type HookContext, type HookInput } from './types.ts';

/** A hook handler: its answer is printed as JSON; `null` prints nothing. */
export type HookHandler = (input: HookInput, context: HookContext) => object | null;

/**
 * Reads everything Claude Code wrote to stdin.
 *
 * `readFileSync(0)` is not used because it gives up where a plain read loop
 * does not: on POSIX a pipe left in non-blocking mode answers `EAGAIN` while
 * the writer is still busy, and on Windows a closed pipe can answer `EOF`
 * instead of a zero-length read. A hook that failed here would let a prompt
 * the user meant to hold through to the agent.
 */
function readStdin(): string {
  const chunks: Buffer[] = [];
  const buffer = Buffer.alloc(65536);
  for (;;) {
    let length: number;
    try {
      length = readSync(0, buffer, 0, buffer.length, null);
    } catch (error) {
      const code = errorCode(error);
      if (code === 'EAGAIN') {
        sleep(5);
        continue;
      }
      if (code === 'EOF') break;
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
 * @param name Hook name for the log.
 */
export function runHook(name: string, handler: HookHandler): void {
  let dataDir: string | undefined;
  try {
    dataDir = resolveDataDir();
    const input: unknown = JSON.parse(readStdin());
    if (!isRecord(input)) throw new Error('the hook input is not a JSON object');
    const output = handler(input, { dataDir });
    if (output) process.stdout.write(JSON.stringify(output));
  } catch (error) {
    logEvent(dataDir, 'error', `${name} failed`, describeError(error));
  }
}
