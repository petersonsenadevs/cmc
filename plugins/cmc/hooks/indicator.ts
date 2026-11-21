// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Hooks module: pins "✉ N held" under the prompt while messages are held and
// removes it when the queue is empty.
//
// This file runs inside Claude Code's plugin engine, not in Node: it has no
// `node:` imports and reaches the disk through `$`. It only reads the queue.

const REFRESH_MS = 1000;

/**
 * The parts of the engine's `$` this module uses. Declared here because the
 * engine's own types are not available outside Claude Code.
 */
export interface Engine {
  session: { id(): string | Promise<string> };
  process: { hookEnv(): Record<string, string | undefined> | Promise<Record<string, string | undefined>> };
  fs: { read(path: string): string | Promise<string> };
  clock: { every(ms: number, task: () => Promise<void>): unknown };
  ui: { status(text: string | undefined): unknown };
}

/** A `session.start` handler: `next` runs the rest of the chain and gives its result. */
export type SessionStartHandler = ($: Engine, event: unknown, next: (event: unknown) => unknown) => Promise<unknown>;

/** How the engine lets a hooks module subscribe to its events. */
export type On = (event: 'session.start', handler: SessionStartHandler) => void;

/** Counts the messages in a queue file's text (one JSON object per line). */
export function countHeld(text: string): number {
  return text.split('\n').filter((line) => line.trim() !== '').length;
}

/** The status line for a number of held messages; `undefined` clears it. */
export function statusFor(count: number): string | undefined {
  return count > 0 ? `✉ ${count} held` : undefined;
}

async function heldIn($: Engine, dataDir: string | undefined): Promise<number> {
  const sessionId = await $.session.id();
  try {
    return countHeld(await $.fs.read(`${dataDir}/sessions/${sessionId}/queue.jsonl`));
  } catch {
    // No queue file yet: nothing has been held in this session.
    return 0;
  }
}

export const register = (on: On): void => {
  on('session.start', async ($, e, next) => {
    const result = await next(e);
    const { CLAUDE_PLUGIN_DATA: dataDir } = await $.process.hookEnv();
    let shown: string | undefined;
    const refresh = async (): Promise<void> => {
      const status = statusFor(await heldIn($, dataDir));
      // Only touch the screen when the number changes.
      if (status !== shown) {
        shown = status;
        $.ui.status(status);
      }
    };
    await refresh();
    $.clock.every(REFRESH_MS, refresh);
    return result;
  });
};
