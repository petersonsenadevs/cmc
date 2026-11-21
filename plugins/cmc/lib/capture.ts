// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Decides what happens to a prompt: held, dispatched to a second agent, a
// control word, or passed on to the agent untouched.
import { parseAgentControl, parseDispatch, runAgentControl, startAgent, type DispatchOrigin } from './agent-control.ts';
import { parseControl, runControl } from './control.ts';
import { DEFAULT_CONFIG, keepOpenMsOf, loadConfig, withPrefixes, type CmcConfig } from './config.ts';
import { CmcError } from './errors.ts';
import { assertSessionId, sessionDir } from './paths.ts';
import { addMessage } from './queue.ts';
import { holdReceipt } from './release.ts';
import { updateState, readState } from './session-state.ts';
import type { HookContext, HookInput } from './types.ts';

export const DEFAULT_HOLD_PREFIX = DEFAULT_CONFIG.holdPrefix;
export const DEFAULT_DISPATCH_PREFIX = DEFAULT_CONFIG.dispatchPrefix;

/** The prompt goes no further; `reason` is shown to the user. */
export interface PromptBlock {
  decision: 'block';
  reason: string;
}

/** The prompt goes through, with text for the agent to read next to it. */
export interface PromptContext {
  hookSpecificOutput: { hookEventName: 'UserPromptSubmit'; additionalContext: string };
}

/** What the prompt handler can be told besides where the data lives. */
export interface CaptureOptions {
  prefix?: string;
  dispatchPrefix?: string;
  /** Executable of Claude Code for dispatched agents (tests replace it). */
  claude?: readonly string[];
  env?: NodeJS.ProcessEnv;
}

function block(reason: string): PromptBlock {
  return { decision: 'block', reason };
}

/**
 * Notes that a prompt reached the agent. It never stops the prompt: the flag
 * only refines ";;now", and without it the prompt is still the user's.
 */
function markTurnActive(input: HookInput, dataDir: string): void {
  try {
    updateState(sessionDir(dataDir, input.session_id), { turnActive: true });
  } catch {
    // A session id cmc cannot use as a folder: there is no state to keep for it.
  }
}

/** The session a prompt came from, as a dispatch needs it. */
function originOf(input: HookInput, dir: string, options: CaptureOptions, config: CmcConfig): DispatchOrigin {
  assertSessionId(input.session_id);
  return {
    dir,
    sessionId: input.session_id,
    cwd: typeof input.cwd === 'string' && input.cwd !== '' ? input.cwd : process.cwd(),
    ...(typeof input.transcript_path === 'string' ? { transcriptPath: input.transcript_path } : {}),
    ...(options.claude === undefined ? {} : { claude: options.claude }),
    ...(options.env === undefined ? {} : { env: options.env }),
    permissionMode: config.dispatch.permissionMode,
    tools: config.dispatch.tools,
    restrictTools: config.dispatch.restrictTools,
    keepOpenMs: keepOpenMsOf(config, options.env ?? process.env),
    model: config.dispatch.model,
    effort: config.dispatch.effort,
  };
}

/** What a prefixed prompt does; throws a `CmcError` for what cmc refuses on purpose. */
function answer(
  input: HookInput,
  prompt: string,
  dataDir: string,
  options: Required<Pick<CaptureOptions, 'prefix' | 'dispatchPrefix'>> & CaptureOptions,
  config: CmcConfig,
): PromptBlock | PromptContext {
  const { prefix, dispatchPrefix } = options;
  const defaults = { mode: config.dispatch.context, returnMode: config.dispatch.return };
  // cmc's own hints name the prefixes in force; text the user typed is never rewritten.
  const hints = { ...config, holdPrefix: prefix, dispatchPrefix };

  if (prompt.startsWith(dispatchPrefix)) {
    const { task, ...choice } = parseDispatch(prompt.slice(dispatchPrefix.length), defaults);
    if (task === '') return block(`Nothing to dispatch. Type "${dispatchPrefix} your task" to hand it to a second agent.`);
    return block(withPrefixes(startAgent(originOf(input, sessionDir(dataDir, input.session_id), options, config), task, choice), hints));
  }

  const rest = prompt.slice(prefix.length);
  const text = rest.trim();
  if (text === '') return block(`Nothing to hold. Type "${prefix} your message" to hold one, or "${prefix}help".`);

  const dir = sessionDir(dataDir, input.session_id);
  const control = parseControl(rest);
  if (control) {
    const result = runControl(dir, control, prefix);
    if ('reply' in result) return block(control.name === 'help' ? withPrefixes(result.reply, hints) : result.reply);
    return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: result.context } };
  }
  const agentControl = parseAgentControl(rest, defaults);
  if (agentControl) return block(runAgentControl(originOf(input, dir, options, config), agentControl));

  // Subagent mode: what the user types goes to a new subagent, not to the main agent.
  if (config.holdTarget === 'subagent') return block(startAgent(originOf(input, dir, options, config), text, defaults));

  const { messages, warning } = addMessage(dir, { text });
  const receipt = holdReceipt(messages.length, config.sendAtEnd && readState(dir).turnActive);
  return block(warning ? `${receipt}\n${warning}` : receipt);
}

/**
 * Handles a `UserPromptSubmit` hook call.
 * @returns A hook answer (block the prompt, or add context to it); `null` lets
 *   the prompt through untouched.
 */
export function handlePrompt(
  input: HookInput,
  { dataDir, prefix: givenPrefix, dispatchPrefix: givenDispatchPrefix, ...rest }: HookContext & CaptureOptions,
): PromptBlock | PromptContext | null {
  const { config } = loadConfig(dataDir);
  const prefix = givenPrefix ?? config.holdPrefix;
  const dispatchPrefix = givenDispatchPrefix ?? config.dispatchPrefix;
  const prompt = input.prompt;
  if (typeof prompt !== 'string') return null;
  if (!(prompt.startsWith(prefix) || prompt.startsWith(dispatchPrefix))) {
    // It goes to the agent: a turn is running from now until the Stop hook.
    markTurnActive(input, dataDir);
    return null;
  }

  try {
    const output = answer(input, prompt, dataDir, { ...rest, prefix, dispatchPrefix }, config);
    if ('hookSpecificOutput' in output) markTurnActive(input, dataDir);
    return output;
  } catch (error) {
    // What cmc refuses on purpose (too long, no such position, no such agent)
    // is explained to the user. Anything else is a bug and goes up, where the
    // hook lets the prompt through instead of losing it.
    if (error instanceof CmcError && error.code !== 'BAD_SESSION_ID') return block(`Not done: ${error.message}`);
    throw error;
  }
}
