// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Decides what happens to a prompt: held, a control word, or passed on to the
// agent untouched.
import { parseControl, runControl } from './control.mjs';
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

  const rest = prompt.slice(prefix.length);
  const text = rest.trim();
  if (text === '') return block(`Nothing to hold. Type "${prefix} your message" to hold one, or "${prefix}help".`);

  const dir = sessionDir(dataDir, input.session_id);
  try {
    const control = parseControl(rest);
    if (control) return block(runControl(dir, control));

    const { messages, warning } = addMessage(dir, { text });
    const receipt = `Held (${messages.length} queued). Release with /cmc:release.`;
    return block(warning ? `${receipt}\n${warning}` : receipt);
  } catch (error) {
    // What cmc refuses on purpose (too long, no such position) is explained to
    // the user. Anything else is a bug and goes up, where the hook lets the
    // prompt through instead of losing it.
    if (error instanceof CmcError && error.code !== 'BAD_SESSION_ID') return block(`Not done: ${error.message}`);
    throw error;
  }
}
