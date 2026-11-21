// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// The one hooks module Claude Code's plugin engine loads (hooks.json names it):
// the status line indicator, the interactive interface and the control panel. Engine code only:
// no `node:` imports in this file or in what it imports.
// The engine takes one `session.start` hook per module, so both start here.
import { startIndicator, type Engine } from './indicator.ts';
import { register as registerInterface, startInterface, type InterfaceOn } from './interface.ts';
import { register as registerPanel, startPanel, type PanelEngine, type PanelOn } from './panel.ts';

type SessionOn = (
  event: 'session.start',
  handler: ($: Engine & PanelEngine, e: unknown, next: (event: unknown) => Promise<unknown>) => Promise<unknown>,
) => void;

export const register = (on: SessionOn & InterfaceOn & PanelOn): void => {
  on('session.start', async ($, e, next) => {
    const result = await next(e);
    // Each part starts on its own: one failing does not stop the others.
    // The interface first: it learns the data folder the panel reads.
    await Promise.allSettled([startIndicator($), startInterface($)]);
    await startPanel($).catch(() => undefined);
    return result;
  });
  registerInterface(on);
  registerPanel(on);
};
