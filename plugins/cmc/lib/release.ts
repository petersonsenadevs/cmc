// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Hands held messages over to the agent: takes them out of the queue and
// words them so the agent reads them as what they are, things the user typed.
import { CmcError } from './errors.ts';
import { sessionDir } from './paths.ts';
import { drainMessages, listMessages, type HeldMessage } from './queue.ts';
import { mergeSelection, readState, updateState, updateStateWith, type Selection } from './session-state.ts';
import { touchSession } from './sessions.ts';
import { loadConfig } from './config.ts';
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
/** Every line break a text can carry, so none can escape the indentation. */
const LINE_BREAK = /\r\n|\r|\n|\u2028|\u2029|\u0085/;

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
 * Formats messages the user typed while the agent worked, handed over by
 * themselves when its turn ended (`sendAtEnd`).
 */
export function formatHeldAtEnd(messages: readonly HeldMessage[]): string {
  const [what, them] = messages.length === 1 ? ['this message', 'it'] : ['these messages', 'them'];
  return `[cmc] The user typed ${what} while you were working; cmc held ${them} until your turn ended:
${formatItems(messages)}`;
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
      // Every kind of line break counts: \r, \r\n and the Unicode separators too.
      return label + body.split(LINE_BREAK).join(`\n${pad}`);
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
  updateStateWith(dir, (state) => ({ atEnd: mergeSelection(state.atEnd, selection) }));
}

/**
 * Handles a `Stop` hook call: when a release is pending and something is held,
 * the turn continues with the held messages.
 * @returns `null` lets the turn end.
 */
export function handleStop(input: HookInput, { dataDir }: HookContext): StopBlock | null {
  const dir = sessionDir(dataDir, input.session_id);
  touchSession(dir);
  // A Stop hook (cmc's or another plugin's) may already be continuing the turn:
  // cmc still delivers what is pending. It cannot loop, since whatever it
  // delivers leaves the queue, and the next stop finds nothing.
  // The pending releases are taken and cleared in one step, and only then are
  // messages taken out of the queue: if anything fails before that, the
  // messages are still held. Taking them out is the last thing that touches the
  // disk before the answer is printed.
  const { config } = loadConfig(dataDir);
  // Messages the user typed go by themselves when sendAtEnd is on; results of
  // agents wait as their return mode says.
  const typed = config.sendAtEnd ? listMessages(dir).messages.filter((message) => agentOf(message.source) === null).map((message) => message.id) : [];
  let pending: Pending = { atEnd: null, autoReturn: null, typed: [] };
  updateStateWith(dir, (state) => {
    pending = { atEnd: state.atEnd, autoReturn: state.autoReturn, typed };
    const continues = state.atEnd !== null || state.autoReturn !== null || typed.length > 0;
    // The turn goes on only when cmc itself continues it.
    return { atEnd: null, autoReturn: null, turnActive: continues };
  });
  return stopAnswer(dir, pending, config.holdPrefix);
}

/** What a stop has to deliver: releases the user armed, results to return, and messages typed meanwhile. */
interface Pending {
  atEnd: Selection;
  autoReturn: Selection;
  typed: string[];
}

/** What the state looked like before `handleStop` cleared it: the releases to deliver. */
function stopAnswer(dir: string, pending: Pending, holdPrefix: string): StopBlock | null {
  if (pending.atEnd === null && pending.autoReturn === null && pending.typed.length === 0) return null;

  const parts: string[] = [];
  if (pending.atEnd !== null) {
    const { text } = release(dir, pending.atEnd, `${holdPrefix}end`);
    if (text !== null) parts.push(text);
  }
  // Typed while the agent worked and not released above: they go now.
  if (pending.typed.length > 0) {
    const { messages } = drainMessages(dir, pending.typed);
    if (messages.length > 0) parts.push(formatHeldAtEnd(messages));
  }
  // Results the user asked to get back by themselves. One the user already
  // released above (or deleted) is gone from the queue and is not repeated.
  if (pending.autoReturn !== null) {
    const { messages } = drainMessages(dir, pending.autoReturn === 'all' ? undefined : pending.autoReturn);
    if (messages.length > 0) parts.push(formatAutoReturn(messages));
  }
  // One continuation for everything: the Stop hook never chains a second one.
  return parts.length === 0 ? null : { decision: 'block', reason: parts.join('\n\n') };
}

/** What `sendMessages` decided: hand the messages over now, at the end of the turn, or nothing to send. */
export type SendOutcome =
  | { mode: 'now'; count: number; text: string; ids: string[] }
  | { mode: 'end'; count: number }
  | { mode: 'none' };

/**
 * Sends held messages the safe way: at once when the agent is idle, or when its
 * turn ends while it is working, since text handed over in the middle of a turn
 * is too often set aside (D-030).
 *
 * "now" takes nothing out of the queue: the caller submits `text` as a prompt
 * and calls `takeMessages(ids)` only once the prompt was accepted, so a refused
 * prompt leaves the messages held instead of losing them.
 * @param positions Messages to send, as the user sees them; none means all.
 */
export function sendMessages(dir: string, positions: number[], trigger = '/send'): SendOutcome {
  const { selection, count, held } = select(dir, positions);
  if (held === 0 || count === 0 || selection === null) return { mode: 'none' };
  if (readState(dir).turnActive) {
    armAtEnd(dir, selection);
    return { mode: 'end', count };
  }
  const { messages } = listMessages(dir);
  const chosen = selection === 'all' ? messages : messages.filter((message) => selection.includes(message.id));
  if (chosen.length === 0) return { mode: 'none' };
  return { mode: 'now', count: chosen.length, text: formatRelease(chosen, trigger), ids: chosen.map((message) => message.id) };
}

/**
 * Takes sent messages out of the queue by id, after their prompt was accepted.
 * One deleted or already sent meanwhile is simply not there any more.
 * @returns How many were taken.
 */
export function takeMessages(dir: string, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  return drainMessages(dir, [...ids]).messages.length;
}

/**
 * The receipt for a held message: what will happen to it.
 * @param atEnd The agent is working and sendAtEnd is on: it goes when the turn ends.
 */
export function holdReceipt(count: number, atEnd: boolean): string {
  return atEnd
    ? `Held (${count} queued). It goes to the agent when its turn ends; /held to change or delete it.`
    : `Held (${count} queued). /held or /send to send it.`;
}
