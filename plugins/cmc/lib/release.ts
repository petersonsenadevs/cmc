// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Hands held messages over to the agent: takes them out of the queue and
// words them so the agent reads them as what they are, things the user typed.
import { CmcError } from './errors.ts';
import { sessionDir } from './paths.ts';
import { drainMessages, listMessages } from './queue.ts';
import { mergeSelection, readState, updateState } from './session-state.ts';
import { touchSession } from './sessions.ts';

/**
 * Formats released messages for the agent.
 *
 * The header is short and factual on purpose: it names the plugin and the
 * user's own action. Imperative framing ("treat the following as…") made the
 * model distrust the text (ADR 001, finding f).
 * @param {import('./queue.ts').HeldMessage[]} messages
 * @param {string} trigger What the user did to release them, e.g. `/cmc:release`.
 * @returns {string}
 */
export function formatRelease(messages, trigger) {
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
 * @param {string} dir Session folder.
 * @param {import('./session-state.ts').Selection} selection
 * @param {string} trigger
 * @returns {{ count: number, text: string | null, warning?: string }}
 */
export function release(dir, selection, trigger) {
  if (selection === null) return { count: 0, text: null };
  const { messages, warning } = drainMessages(dir, selection === 'all' ? undefined : selection);
  return { count: messages.length, text: messages.length > 0 ? formatRelease(messages, trigger) : null, warning };
}

/**
 * Takes the whole queue of a session and formats it.
 * @param {string} dataDir
 * @param {string} sessionId
 * @param {string} trigger
 */
export function releaseAll(dataDir, sessionId, trigger) {
  return release(sessionDir(dataDir, sessionId), 'all', trigger);
}

/**
 * Turns the positions the user sees into a selection of message ids.
 * No positions means the whole queue.
 * @param {string} dir Session folder.
 * @param {number[]} [positions]
 * @returns {{ selection: import('./session-state.ts').Selection, count: number, held: number }}
 */
export function select(dir, positions = []) {
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
 * @param {string} dir Session folder.
 * @param {'atEnd' | 'atNextStep'} when
 * @param {import('./session-state.ts').Selection} selection
 */
export function arm(dir, when, selection) {
  updateState(dir, { [when]: mergeSelection(readState(dir)[when], selection) });
}

/**
 * Handles a `Stop` hook call: when a release is pending and something is held,
 * the turn continues with the held messages.
 * @param {{ session_id?: string, stop_hook_active?: boolean }} input
 * @param {{ dataDir: string }} context
 * @returns {{ decision: 'block', reason: string } | null} `null` lets the turn end.
 */
export function handleStop(input, { dataDir }) {
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
 * @param {{ session_id?: string }} input
 * @param {{ dataDir: string }} context
 * @returns {{ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: string } } | null}
 */
export function handlePostToolUse(input, { dataDir }) {
  const dir = sessionDir(dataDir, input.session_id);
  const { atNextStep } = readState(dir);
  if (atNextStep === null) return null;

  const { text } = release(dir, atNextStep, 'cmc release --now');
  updateState(dir, { atNextStep: null });
  return text === null ? null : { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } };
}
