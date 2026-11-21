// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Hooks module: pins "✉ N held · ⚙ M agents" under the prompt while messages
// are held or dispatched agents are working, and removes it when neither is.
//
// This file runs inside Claude Code's plugin engine, not in Node: it has no
// `node:` imports and reaches the disk through `$`. It only reads files.

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

/** Reads the number of working agents from the text of `agents/active.json`. */
export function countActive(text: string): number {
  try {
    const value: unknown = JSON.parse(text);
    const active = typeof value === 'object' && value !== null && 'active' in value ? value.active : 0;
    return typeof active === 'number' && active > 0 ? Math.floor(active) : 0;
  } catch {
    // Caught mid-write or damaged: the next refresh reads it again.
    return 0;
  }
}

/**
 * The status line for a number of held messages and of dispatched agents
 * still working; `undefined` clears it.
 */
export function statusFor(held: number, agents = 0): string | undefined {
  const parts: string[] = [];
  if (held > 0) parts.push(`✉ ${held} held`);
  if (agents > 0) parts.push(`⚙ ${agents} ${agents === 1 ? 'agent' : 'agents'}`);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

async function readOr($: Engine, path: string): Promise<string> {
  try {
    return await $.fs.read(path);
  } catch {
    // The file does not exist yet: nothing held, or no agent dispatched.
    return '';
  }
}

async function countsIn($: Engine, dataDir: string | undefined): Promise<[number, number]> {
  const session = `${dataDir}/sessions/${await $.session.id()}`;
  return [countHeld(await readOr($, `${session}/queue.jsonl`)), countActive(await readOr($, `${session}/agents/active.json`))];
}

export const register = (on: On): void => {
  on('session.start', async ($, e, next) => {
    const result = await next(e);
    const { CLAUDE_PLUGIN_DATA: dataDir } = await $.process.hookEnv();
    let shown: string | undefined;
    const refresh = async (): Promise<void> => {
      const status = statusFor(...(await countsIn($, dataDir)));
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
