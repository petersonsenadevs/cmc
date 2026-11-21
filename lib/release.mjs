// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Hands held messages over to the agent: takes them out of the queue and
// words them so the agent reads them as what they are, things the user typed.
import { sessionDir } from './paths.mjs';
import { drainMessages } from './queue.mjs';
import { readState, updateState } from './session-state.mjs';

/**
 * Formats released messages for the agent.
 *
 * The header is short and factual on purpose: it names the plugin and the
 * user's own action. Imperative framing ("treat the following as…") made the
 * model distrust the text (ADR 001, finding f).
 * @param {import('./queue.mjs').HeldMessage[]} messages
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
 * Takes the whole queue of a session and formats it.
 * @param {string} dataDir
 * @param {string} sessionId
 * @param {string} trigger
 * @returns {{ count: number, text: string | null, warning?: string }}
 */
export function releaseAll(dataDir, sessionId, trigger) {
  const dir = sessionDir(dataDir, sessionId);
  const { messages, warning } = drainMessages(dir);
  return { count: messages.length, text: messages.length > 0 ? formatRelease(messages, trigger) : null, warning };
}

/**
 * Handles a `Stop` hook call: when the user asked for delivery at the end of
 * the turn and something is held, the turn continues with the held messages.
 * @param {{ session_id?: string, stop_hook_active?: boolean }} input
 * @param {{ dataDir: string }} context
 * @returns {{ decision: 'block', reason: string } | null} `null` lets the turn end.
 */
export function handleStop(input, { dataDir }) {
  // Already continuing because of a Stop hook: never chain a second continuation.
  if (input.stop_hook_active === true) return null;

  const dir = sessionDir(dataDir, input.session_id);
  if (!readState(dir).releaseAtEnd) return null;

  const { text } = releaseAll(dataDir, input.session_id, ';;end');
  updateState(dir, { releaseAtEnd: false });
  return text === null ? null : { decision: 'block', reason: text };
}
