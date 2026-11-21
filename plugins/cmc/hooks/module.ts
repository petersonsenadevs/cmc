// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// The one hooks module Claude Code's plugin engine loads (hooks.json names it):
// the status line indicator and the interactive interface. Engine code only:
// no `node:` imports in this file or in what it imports.
// The engine takes one `session.start` hook per module, so both start here.
import { startIndicator, type Engine } from './indicator.ts';
import { register as registerInterface, startInterface, type InterfaceEngine, type InterfaceOn } from './interface.ts';

type SessionOn = (
  event: 'session.start',
  handler: ($: Engine & InterfaceEngine, e: unknown, next: (event: unknown) => Promise<unknown>) => Promise<unknown>,
) => void;

export const register = (on: SessionOn & InterfaceOn): void => {
  on('session.start', async ($, e, next) => {
    const result = await next(e);
    // Each part starts on its own: one failing does not stop the other.
    await Promise.allSettled([startIndicator($), startInterface($)]);
    return result;
  });
  registerInterface(on);
};
