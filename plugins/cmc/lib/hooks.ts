// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// The command hooks of the plugin, by name. `hooks/run.js` starts one of them;
// each loads only the modules it needs.
import { runHook, type HookHandler } from './hook-io.ts';
import { logEvent } from './log.ts';

const HOOKS: Record<string, () => Promise<HookHandler>> = {
  // UserPromptSubmit: holds the prompts that start with the hold prefix.
  'prompt-capture': async () => (await import('./capture.ts')).handlePrompt,
  // PostToolUse: delivers a release armed from outside the session.
  'tool-release': async () => (await import('./release.ts')).handlePostToolUse,
  // Stop: delivers the held messages at the end of the turn when asked to.
  'stop-release': async () => (await import('./release.ts')).handleStop,
  // SessionStart and SessionEnd: keeps the registry the command line uses to
  // find the session running in a folder.
  'session-register': async () => {
    const { handleSessionEnd, handleSessionStart } = await import('./sessions.ts');
    return (input, context) =>
      input.hook_event_name === 'SessionEnd' ? handleSessionEnd(input, context) : handleSessionStart(input, context);
  },
};

/**
 * Runs the hook with that name. Like every hook of cmc it fails open: an
 * unknown name or a module that cannot be loaded is logged, nothing is
 * printed, and Claude Code carries on as if the plugin were not installed.
 */
export async function runNamedHook(name: string | undefined): Promise<void> {
  const load = name === undefined ? undefined : HOOKS[name];
  if (load === undefined) {
    logEvent(process.env.CLAUDE_PLUGIN_DATA, 'error', 'unknown hook', { name });
    return;
  }
  let handler: HookHandler;
  try {
    handler = await load();
  } catch (error) {
    logEvent(process.env.CLAUDE_PLUGIN_DATA, 'error', `${name} could not be loaded`, { message: String(error) });
    return;
  }
  runHook(name ?? '', handler);
}
