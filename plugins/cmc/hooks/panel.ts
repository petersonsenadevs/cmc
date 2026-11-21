// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// The control panel: a pane beside the chat, drawn by Claude Code's own plugin
// engine, with the held messages and a button for each action. A click runs
// the cmc command line, like everything else in the interface, and the pane
// redraws by itself when the queue changes.
//
// Engine code only: no `node:` imports. Elements are built by calling them
// (`Box({ ... })`), which is what JSX compiles to.
import { cli, currentDataDir, sendHeld, type HeldEntry, type InterfaceEngine } from './interface.ts';

export const PANE_ID = 'cmc';
const PANE_TITLE = 'cmc';
/** How often the pane checks the queue for changes. */
const REFRESH_MS = 1000;
/** How much of a message a row shows. */
const ROW_LENGTH = 70;

/** An element as the engine builds it: plain data the module only passes on. */
export type Element = unknown;
type Children = Element | readonly Element[];
type Make<P> = (props: P & { children?: Children }) => Element;

/** The elements of a drawing surface the panel uses (the engine's own types are not available outside it). */
export interface PanelElements {
  Box: Make<{ key?: string; flexDirection?: 'row' | 'column'; gap?: number; columnGap?: number; marginTop?: number; flexWrap?: 'wrap' | 'nowrap' }>;
  Text: Make<{ bold?: boolean; dimColor?: boolean; wrap?: 'truncate-end' | 'wrap' }>;
  Button: Make<{ key: string; label: string; onPress: () => Promise<unknown> | void; dimColor?: boolean; variant?: 'primary' | 'secondary' }>;
}

/** What a `ui.render` hook on the pane receives. */
export interface PaneRenderEvent {
  surface: string;
  component: string;
  requestId?: string;
}

/** The parts of `$` the panel uses, on top of the interface's. */
export interface PanelEngine extends InterfaceEngine {
  clock: InterfaceEngine['clock'] & { every(ms: number, task: () => Promise<void>): unknown };
  ui: InterfaceEngine['ui'] & {
    toast(text: string, options?: { timeoutMs?: number }): void;
    open(pane: { id: string; title?: string; closeOnEscape?: true }): Promise<{ isPlaced?: boolean }>;
    invalidate(event: 'ui.render'): void;
    resolve(e: PaneRenderEvent): PanelElements;
  };
}

export type PanelOn = {
  (
    event: 'ui.render',
    matcher: { component: 'Pane'; requestId: string },
    handler: ($: PanelEngine, e: PaneRenderEvent, next: (e: PaneRenderEvent) => Promise<unknown>) => Promise<unknown>,
  ): void;
  (
    event: 'command.run',
    matcher: { command: string },
    handler: ($: PanelEngine, e: { command: string; args: string }, next: (e: { command: string; args: string }) => Promise<unknown>) => Promise<unknown>,
  ): void;
};

export const PANEL_COMMAND = Object.freeze({ name: 'cmc', description: 'cmc: open the control panel (held messages, with buttons)', immediate: true } as const);

/** Reads the queue file's text into messages; a line that cannot be read is skipped. */
export function parseQueue(text: string): HeldEntry[] {
  return text.split('\n').flatMap((line) => {
    if (line.trim() === '') return [];
    try {
      const value: unknown = JSON.parse(line);
      if (typeof value !== 'object' || value === null) return [];
      const { id, text: body, source } = value as Record<string, unknown>;
      return typeof id === 'string' && typeof body === 'string' ? [{ id, text: body, source: typeof source === 'string' ? source : 'user' }] : [];
    } catch {
      return [];
    }
  });
}

/** One line of a message for its row. */
export function rowText(position: number, entry: HeldEntry): string {
  const line = entry.text.replace(/\s+/g, ' ').trim();
  const short = line.length > ROW_LENGTH ? `${line.slice(0, ROW_LENGTH - 1)}…` : line;
  const from = entry.source.startsWith('agent ') ? ` (from ${entry.source})` : '';
  return `${position}. ${short}${from}`;
}

async function sessionFile($: InterfaceEngine, name: string): Promise<string> {
  try {
    return await $.fs.read(`${currentDataDir()}/sessions/${await $.session.id()}/${name}`);
  } catch {
    return '';
  }
}

/** The settings file of the plugin (at the root of its data folder), or nothing. */
async function settingsText($: InterfaceEngine): Promise<string> {
  try {
    return await $.fs.read(`${currentDataDir()}/config.json`);
  } catch {
    return '';
  }
}

async function queueText($: InterfaceEngine): Promise<string> {
  return sessionFile($, 'queue.jsonl');
}

/** Whether the agent is working, from the session state file. */
export function isWorking(stateText: string): boolean {
  try {
    const value: unknown = JSON.parse(stateText);
    return typeof value === 'object' && value !== null && 'turnActive' in value && value.turnActive === true;
  } catch {
    return false;
  }
}

/** Whether held messages go by themselves at the end of a turn (the sendAtEnd setting, true unless set to false). */
export function sendsAtEnd(configText: string): boolean {
  try {
    const value: unknown = JSON.parse(configText);
    return !(typeof value === 'object' && value !== null && 'sendAtEnd' in value && value.sendAtEnd === false);
  } catch {
    return true;
  }
}

/** The line under the header: what the agent is doing, and so what Send does. */
export function statusLine(working: boolean, atEnd: boolean): string {
  if (!working) return '○ Agent idle · Send hands a message over now';
  return atEnd ? '● Agent working · held messages go to it when its turn ends' : '● Agent working · Send hands a message over when its turn ends';
}

/** What the toast says after "To agent": which agent took the message, or why it could not. */
export function dispatchToast(receipt: string): string {
  const agent = receipt.match(/Dispatched to agent ([0-9a-f]+)/)?.[1];
  return agent === undefined
    ? firstSentence(receipt.trim())
    : `Subagent ${agent} took the message, with ${/inherits this conversation/.test(receipt) ? 'the whole conversation' : 'a summary of the conversation'} as context; it works apart and its result comes back here.`;
}

/** The first sentence of a command's answer, short enough for a toast. */
export function firstSentence(text: string): string {
  const line = text.replace(/^\[cmc\]\s*/, '').split('\n')[0] ?? '';
  const end = line.search(/\.(\s|$)/);
  return end < 0 ? line : line.slice(0, end + 1);
}

/** Opens the pane (or brings it forward); says so when the terminal has no room for it. */
export async function openPanel($: PanelEngine): Promise<string> {
  const placed = await $.ui.open({ id: PANE_ID, title: PANE_TITLE, closeOnEscape: true });
  return placed.isPlaced === false
    ? 'The cmc panel cannot be shown here: the terminal is too narrow, or the session has no screen. Widen the window, or use /held.'
    : 'cmc panel opened. Escape closes it.';
}

/** Starts the live refresh: the pane redraws when the queue file changes. */
export async function startPanel($: PanelEngine): Promise<void> {
  await $.command.register(PANEL_COMMAND);
  // The queue and the state: a message held, or the agent starting or ending a turn, redraws.
  const snapshot = async () => `${await queueText($)}\n${await sessionFile($, 'state.json')}`;
  let last = await snapshot();
  $.clock.every(REFRESH_MS, async () => {
    const now = await snapshot();
    if (now !== last) {
      last = now;
      $.ui.invalidate('ui.render');
    }
  });
}

/** Runs one action, says what it did in a toast, then redraws at once instead of waiting for the next refresh. */
async function act($: PanelEngine, action: () => Promise<string | null>): Promise<void> {
  try {
    const said = await action();
    if (said) $.ui.toast(`cmc: ${said}`, { timeoutMs: 5000 });
  } catch (error) {
    $.ui.toast(`cmc: ${error instanceof Error ? error.message : String(error)}`, { timeoutMs: 8000 });
  }
  $.ui.invalidate('ui.render');
}

/** The current position of a message, found by id at the moment of the click (the queue may have moved). */
async function positionOf($: PanelEngine, id: string): Promise<string | null> {
  const index = parseQueue(await queueText($)).findIndex((entry) => entry.id === id);
  return index < 0 ? null : String(index + 1);
}

async function sendOne($: PanelEngine, id: string): Promise<string | null> {
  const at = await positionOf($, id);
  if (at === null) return 'That message is no longer held.';
  return (await sendHeld($, [at])).text;
}

async function deleteOne($: PanelEngine, id: string): Promise<string | null> {
  await cli($, ['take', id]);
  return 'Deleted.';
}

/** Hands one held message to a new agent, which works on it in its own context (and worktree). */
async function toAgent($: PanelEngine, id: string): Promise<string | null> {
  const at = await positionOf($, id);
  if (at === null) return 'That message is no longer held.';
  const started = await cli($, ['dispatch', '--message', at]);
  return dispatchToast(started.stdout);
}

async function sendAll($: PanelEngine): Promise<string | null> {
  return (await sendHeld($, [])).text;
}

async function clearAll($: PanelEngine): Promise<string | null> {
  await cli($, ['clear']);
  return 'Every held message was deleted.';
}

/** Draws the pane from the queue as it is now. */
export async function drawPanel($: PanelEngine, e: PaneRenderEvent): Promise<Element> {
  const { Box, Text, Button } = $.ui.resolve(e);
  const entries = parseQueue(await queueText($));
  const working = isWorking(await sessionFile($, 'state.json'));
  const atEnd = sendsAtEnd(await settingsText($));
  const rows = entries.map((entry, index) =>
    Box({
      key: `row-${entry.id}`,
      flexDirection: 'row',
      columnGap: 1,
      children: [
        Text({ wrap: 'truncate-end', children: rowText(index + 1, entry) }),
        Button({ key: `send-${entry.id}`, label: 'Send', onPress: () => act($, () => sendOne($, entry.id)) }),
        Button({ key: `agent-${entry.id}`, label: 'To subagent', onPress: () => act($, () => toAgent($, entry.id)) }),
        Button({ key: `delete-${entry.id}`, label: 'Delete', dimColor: true, onPress: () => act($, () => deleteOne($, entry.id)) }),
      ],
    }),
  );
  const header = Text({ bold: true, children: entries.length === 0 ? 'Nothing is held' : `✉ ${entries.length} held` });
  const body =
    entries.length === 0
      ? Text({ dimColor: true, children: 'Type ";; message" while the agent works: it waits here until its turn ends.' })
      : Box({ flexDirection: 'column', children: rows });
  const actions =
    entries.length === 0
      ? null
      : Box({
          flexDirection: 'row',
          columnGap: 1,
          marginTop: 1,
          children: [
            Button({ key: 'send-all', label: 'Send all', variant: 'primary', onPress: () => act($, () => sendAll($)) }),
            Button({ key: 'clear', label: 'Clear', dimColor: true, onPress: () => act($, () => clearAll($)) }),
          ],
        });
  const status = Text({ dimColor: true, children: statusLine(working, atEnd) });
  return Box({ flexDirection: 'column', gap: 1, children: [Box({ flexDirection: 'column', children: [header, status] }), body, actions] });
}

export const register = (on: PanelOn): void => {
  on('command.run', { command: PANEL_COMMAND.name }, async ($) => ({ text: await openPanel($), isTextDisplayOnly: true }));
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => drawPanel($, e));
};
