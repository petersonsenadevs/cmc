// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Decides what happens to a prompt: held, a control word, or passed on to the
// agent untouched.
import { parseControl, runControl } from './control.ts';
import { CmcError } from './errors.ts';
import { sessionDir } from './paths.ts';
import { addMessage } from './queue.ts';
import type { HookContext, HookInput } from './types.ts';

export const DEFAULT_HOLD_PREFIX = ';;';

/** The prompt goes no further; `reason` is shown to the user. */
export interface PromptBlock {
  decision: 'block';
  reason: string;
}

/** The prompt goes through, with text for the agent to read next to it. */
export interface PromptContext {
  hookSpecificOutput: { hookEventName: 'UserPromptSubmit'; additionalContext: string };
}

function block(reason: string): PromptBlock {
  return { decision: 'block', reason };
}

/**
 * Handles a `UserPromptSubmit` hook call.
 * @returns A hook answer (block the prompt, or add context to it); `null` lets the
 *   prompt through untouched.
 */
export function handlePrompt(
  input: HookInput,
  { dataDir, prefix = DEFAULT_HOLD_PREFIX }: HookContext & { prefix?: string },
): PromptBlock | PromptContext | null {
  const prompt = input.prompt;
  if (typeof prompt !== 'string' || !prompt.startsWith(prefix)) return null;

  const rest = prompt.slice(prefix.length);
  const text = rest.trim();
  if (text === '') return block(`Nothing to hold. Type "${prefix} your message" to hold one, or "${prefix}help".`);

  const dir = sessionDir(dataDir, input.session_id);
  try {
    const control = parseControl(rest);
    if (control) {
      const answer = runControl(dir, control);
      if ('reply' in answer) return block(answer.reply);
      return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: answer.context } };
    }

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
