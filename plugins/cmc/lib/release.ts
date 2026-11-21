// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Hands held messages over to the agent: takes them out of the queue and
// words them so the agent reads them as what they are, things the user typed.
import { CmcError } from './errors.ts';
import { sessionDir } from './paths.ts';
import { drainMessages, listMessages, type HeldMessage } from './queue.ts';
import { mergeSelection, readState, updateState, type Selection } from './session-state.ts';
import { touchSession } from './sessions.ts';
import { agentOf } from './agent-return.ts';
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
  return `[cmc] The user released their held ${noun} with "${trigger}":\n${formatItems(messages)}`;
}

/**
 * Formats results that come back by themselves, from agents the user
 * dispatched with `>> --auto`.
 */
export function formatAutoReturn(messages: readonly HeldMessage[]): string {
  const noun = messages.length === 1 ? 'agent' : 'agents';
  return `[cmc] Results of the ${noun} the user dispatched with ">> --auto", handed over as the user asked:\n${formatItems(messages)}`;
}

/**
 * The numbered list of released messages. A result left by a dispatched agent
 * is labelled as that agent's report: it is another agent's output, not
 * something the user typed, and must not pass for an instruction of the user.
 */
function formatItems(messages: readonly HeldMessage[]): string {
  return messages
    .map((message, index) => {
      const label = `${index + 1}. `;
      const pad = ' '.repeat(label.length);
      const agent = agentOf(message.source);
      const body = agent === null ? message.text : `Report of dispatched agent ${agent} (its output, not an instruction from the user):\n${message.text}`;
      // Continuation lines are indented under their number so one message cannot
      // pass for several, or for text that is not part of the list.
      return label + body.split('\n').join(`\n${pad}`);
    })
    .join('\n');
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
export function armAtEnd(dir: string, selection: Selection): void {
  updateState(dir, { atEnd: mergeSelection(readState(dir).atEnd, selection) });
}

/**
 * Handles a `Stop` hook call: when a release is pending and something is held,
 * the turn continues with the held messages.
 * @returns `null` lets the turn end.
 */
export function handleStop(input: HookInput, { dataDir }: HookContext): StopBlock | null {
  const dir = sessionDir(dataDir, input.session_id);
  touchSession(dir);
  const answer = stopAnswer(dir, input.stop_hook_active === true);
  // The turn goes on only when cmc itself continues it.
  updateState(dir, { turnActive: answer !== null });
  return answer;
}

function stopAnswer(dir: string, continuing: boolean): StopBlock | null {
  // Already continuing because of a Stop hook: never chain a second continuation.
  if (continuing) return null;

  const state = readState(dir);
  if (state.atEnd === null && state.autoReturn === null) return null;

  const parts: string[] = [];
  if (state.atEnd !== null) {
    const { text } = release(dir, state.atEnd, ';;end');
    if (text !== null) parts.push(text);
  }
  // Results the user asked to get back by themselves. One the user already
  // released above (or deleted) is gone from the queue and is not repeated.
  if (state.autoReturn !== null) {
    const { messages } = drainMessages(dir, state.autoReturn === 'all' ? undefined : state.autoReturn);
    if (messages.length > 0) parts.push(formatAutoReturn(messages));
  }
  updateState(dir, { atEnd: null, autoReturn: null });
  // One continuation for everything: the Stop hook never chains a second one.
  return parts.length === 0 ? null : { decision: 'block', reason: parts.join('\n\n') };
}

