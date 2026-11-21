// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Small per-session flags that live next to the queue (state.json).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomic } from './atomic-write.ts';
import { isRecord } from './types.ts';

const STATE_FILE = 'state.json';

/**
 * Which held messages a pending release covers: nothing, the whole queue
 * (including what gets held later), or the messages with these ids.
 */
export type Selection = null | 'all' | string[];

export interface SessionState {
  /** Deliver when the current turn ends. */
  atEnd: Selection;
  /** Deliver at the agent's next step (armed from outside the session). */
  atNextStep: Selection;
  /** Results of agents dispatched with `--auto`: delivered when a turn ends. */
  autoReturn: Selection;
}

function selection(value: unknown): Selection {
  if (value === 'all') return 'all';
  if (Array.isArray(value) && value.length > 0) {
    const ids: unknown[] = value;
    if (ids.every((id): id is string => typeof id === 'string')) return ids;
  }
  return null;
}

/**
 * Adds a selection to one that is already pending.
 */
export function mergeSelection(current: Selection, added: Selection): Selection {
  if (current === 'all' || added === 'all') return 'all';
  const ids = [...(current ?? []), ...(added ?? [])];
  return ids.length > 0 ? [...new Set(ids)] : null;
}

/**
 * @param dir Session folder.
 */
export function readState(dir: string): SessionState {
  const file = join(dir, STATE_FILE);
  if (!existsSync(file)) return { atEnd: null, atNextStep: null, autoReturn: null };
  try {
    const stored: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const fields = isRecord(stored) ? stored : {};
    return { atEnd: selection(fields.atEnd), atNextStep: selection(fields.atNextStep), autoReturn: selection(fields.autoReturn) };
  } catch (error) {
    // An unreadable state file only means "no release pending": the queue
    // itself is untouched, so falling back to the defaults loses nothing.
    if (error instanceof SyntaxError) return { atEnd: null, atNextStep: null, autoReturn: null };
    throw error;
  }
}

/**
 * @param dir Session folder.
 */
export function updateState(dir: string, patch: Partial<SessionState>): SessionState {
  const next = { ...readState(dir), ...patch };
  writeFileAtomic(join(dir, STATE_FILE), `${JSON.stringify(next)}\n`);
  return next;
}
