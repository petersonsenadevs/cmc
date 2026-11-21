// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Hands held messages over to the agent: takes them out of the queue and
// words them so the agent reads them as what they are, things the user typed.
import { CmcError } from './errors.ts';
import { sessionDir } from './paths.ts';
import { drainMessages, listMessages, type HeldMessage } from './queue.ts';
import { mergeSelection, readState, updateState, type Selection } from './session-state.ts';
import { touchSession } from './sessions.ts';
import type { HookContext, HookInput } from './types.ts';

/** What a release took out of the queue. */
export interface ReleaseResult {
  count: number;
  /** The messages worded for the agent; `null` when nothing was released. */
  text: string | null;
  /** Set when a damaged queue file had to be repaired. */
  warning?: string;
}

/** A `Stop` hook answer that makes the turn continue with `reason`. */
export interface StopBlock {
  decision: 'block';
  reason: string;
}

/** A `PostToolUse` hook answer that hands text to the agent. */
export interface PostToolUseContext {
  hookSpecificOutput: { hookEventName: 'PostToolUse'; additionalContext: string };
}

/**
 * Formats released messages for the agent.
 *
 * The header is short and factual on purpose: it names the plugin and the
 * user's own action. Imperative framing ("treat the following as…") made the
 * model distrust the text (ADR 001, finding f).
 * @param trigger What the user did to release them, e.g. `/cmc:release`.
 */
export function formatRelease(messages: readonly HeldMessage[], trigger: string): string {
  const noun = messages.length === 1 ? 'message' : 'messages';
  const lines = messages.map((message, index) => {
    const label = `${index + 1}. `;
    // Continuation lines are indented under their number so one message cannot
    // pass for several, or for text that is not part of the list.
    return label + message.text.split('\n').join(`\n${' '.repeat(label.length)}`);
  });
  return `[cmc] The user released their held ${noun} with "${trigger}":\n${lines.join('\n')}`;
}

/**
 * Takes messages out of a session queue and formats them.
 * @param dir Session folder.
 */
export function release(dir: string, selection: Selection, trigger: string): ReleaseResult {
  if (selection === null) return { count: 0, text: null };
  const { messages, warning } = drainMessages(dir, selection === 'all' ? undefined : selection);
  return { count: messages.length, text: messages.length > 0 ? formatRelease(messages, trigger) : null, warning };
}

/**
 * Takes the whole queue of a session and formats it.
 */
export function releaseAll(dataDir: string, sessionId: string, trigger: string): ReleaseResult {
  return release(sessionDir(dataDir, sessionId), 'all', trigger);
}

/**
 * Turns the positions the user sees into a selection of message ids.
 * No positions means the whole queue.
 * @param dir Session folder.
 */
export function select(dir: string, positions: readonly number[] = []): { selection: Selection; count: number; held: number } {
  const { messages } = listMessages(dir);
  if (positions.length === 0) return { selection: 'all', count: messages.length, held: messages.length };
  const ids = positions.map((position) => {
    const message = messages[position - 1];
    if (!message) {
      const size = messages.length === 0 ? 'nothing is held' : `the queue has ${messages.length}`;
      throw new CmcError('NO_SUCH_MESSAGE', `There is no held message ${position} (${size}).`);
    }
    return message.id;
  });
  return { selection: [...new Set(ids)], count: new Set(ids).size, held: messages.length };
}

/**
 * Arms a release for later: at the end of the turn, or at the agent's next step.
 * @param dir Session folder.
 */
export function arm(dir: string, when: 'atEnd' | 'atNextStep', selection: Selection): void {
  const merged = mergeSelection(readState(dir)[when], selection);
  updateState(dir, when === 'atEnd' ? { atEnd: merged } : { atNextStep: merged });
}

/**
 * Handles a `Stop` hook call: when a release is pending and something is held,
 * the turn continues with the held messages.
 * @returns `null` lets the turn end.
 */
export function handleStop(input: HookInput, { dataDir }: HookContext): StopBlock | null {
  const dir = sessionDir(dataDir, input.session_id);
  touchSession(dir);
  // Already continuing because of a Stop hook: never chain a second continuation.
  if (input.stop_hook_active === true) return null;

  const state = readState(dir);
  // A release armed for "the next step" that found no step to ride on is
  // delivered here: the end of the turn is the last chance.
  const pending = mergeSelection(state.atEnd, state.atNextStep);
  if (pending === null) return null;

  const trigger = state.atEnd === null ? 'cmc release --now' : ';;end';
  const { text } = release(dir, pending, trigger);
  updateState(dir, { atEnd: null, atNextStep: null });
  return text === null ? null : { decision: 'block', reason: text };
}

/**
 * Handles a `PostToolUse` hook call: delivers a release that was armed from
 * outside the session (`cmc release --now`) right after the tool that just ran.
 */
export function handlePostToolUse(input: HookInput, { dataDir }: HookContext): PostToolUseContext | null {
  const dir = sessionDir(dataDir, input.session_id);
  const { atNextStep } = readState(dir);
  if (atNextStep === null) return null;

  const { text } = release(dir, atNextStep, 'cmc release --now');
  updateState(dir, { atNextStep: null });
  return text === null ? null : { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } };
}
