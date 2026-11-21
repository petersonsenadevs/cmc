// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Decides what happens to a prompt: held, or passed on to the agent untouched.
import { CmcError } from './errors.mjs';
import { sessionDir } from './paths.mjs';
import { addMessage } from './queue.mjs';

export const DEFAULT_HOLD_PREFIX = ';;';

function block(reason) {
  return { decision: 'block', reason };
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

  const text = prompt.slice(prefix.length).trim();
  if (text === '') return block(`Nothing to hold. Type "${prefix} your message" to hold one.`);

  const dir = sessionDir(dataDir, input.session_id);
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
