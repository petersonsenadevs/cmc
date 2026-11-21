// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// The shared shell of every hook script: read the JSON Claude Code sends on
// stdin, run a handler from the core, print its answer.
import { readFileSync } from 'node:fs';
import { describeError, logEvent } from './log.mjs';
import { resolveDataDir } from './paths.mjs';

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
    const input = JSON.parse(readFileSync(0, 'utf8'));
    const output = handler(input, { dataDir });
    if (output) process.stdout.write(JSON.stringify(output));
  } catch (error) {
    logEvent(dataDir, 'error', `${name} failed`, describeError(error));
  }
}
