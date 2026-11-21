// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Decides what happens to a prompt: held, a control word, or passed on to the
// agent untouched.
import { CmcError } from './errors.mjs';
import { sessionDir } from './paths.mjs';
import { addMessage, listMessages } from './queue.mjs';
import { updateState } from './session-state.mjs';

export const DEFAULT_HOLD_PREFIX = ';;';

// Control words are written right after the prefix, with no space: ";;end".
// With a space (";; end") the text is an ordinary message to hold.
const CONTROL_END = 'end';

function block(reason) {
  return { decision: 'block', reason };
}

function armReleaseAtEnd(dir) {
  const { messages, warning } = listMessages(dir);
  updateState(dir, { releaseAtEnd: true });
  const receipt =
    messages.length > 0
      ? `${messages.length} held message(s) will be released when this turn ends.`
      : 'Nothing is held yet. Whatever you hold next will be released when this turn ends.';
  return block(warning ? `${receipt}\n${warning}` : receipt);
}

/**
 * Handles a `UserPromptSubmit` hook call.
 * @param {{ prompt?: unknown, session_id?: string }} input
 * @param {{ dataDir: string, prefix?: string }} context
 * @returns {{ decision: 'block', reason: string } | null} `null` lets the prompt through.
 */
export function handlePrompt(input, { dataDir, prefix = DEFAULT_HOLD_PREFIX }) {
  const prompt = input.prompt;
  if (typeof prompt !== 'string' || !prompt.startsWith(prefix)) return null;

  const rest = prompt.slice(prefix.length);
  const text = rest.trim();
  if (text === '') return block(`Nothing to hold. Type "${prefix} your message" to hold one.`);

  const dir = sessionDir(dataDir, input.session_id);
  if (rest.trimEnd() === CONTROL_END) return armReleaseAtEnd(dir);

  try {
    const { messages, warning } = addMessage(dir, { text });
    const receipt = `Held (${messages.length} queued). Release with /cmc:release.`;
    return block(warning ? `${receipt}\n${warning}` : receipt);
  } catch (error) {
    // A message cmc refuses (too long) is reported; anything else is a bug and
    // goes up, where the hook lets the prompt through instead of losing it.
    if (error instanceof CmcError && error.code === 'MESSAGE_TOO_LONG') return block(`Not held: ${error.message}`);
    throw error;
  }
}
