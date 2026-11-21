// cmc — test helper: assertions that also narrow the type of what they check. Author: Peterson Sena (r3v3rs3).
import assert from 'node:assert/strict';
import type { PromptBlock, PromptContext } from '../plugins/cmc/lib/capture.ts';
import type { StopBlock } from '../plugins/cmc/lib/release.ts';

/** Anything a hook handler can answer; `null` lets Claude Code carry on untouched. */
type HookAnswer = PromptBlock | PromptContext | StopBlock | null;

/** The first item of a list; fails the test when the list is empty. */
export function first<T>(items: readonly T[]): T {
  const [item] = items;
  assert.ok(item !== undefined, 'expected at least one item');
  return item;
}

/** A value that has to be there; fails the test when it is `null` or `undefined`. */
export function present<T>(value: T | null | undefined): T {
  assert.ok(value !== null && value !== undefined, 'expected a value');
  return value;
}

/** The answer of a hook that blocked; fails the test when it answered anything else. */
export function blocked(answer: HookAnswer): PromptBlock | StopBlock {
  assert.ok(answer !== null && 'decision' in answer, 'expected the hook to block');
  return answer;
}
