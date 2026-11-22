// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// The control panel (ADR 003): a pane beside the chat, drawn by Claude Code's
// own plugin engine, from which everything is controlled: the agent's state,
// the held messages, the subagents with their conversation, the modes, and
// what just happened. Every action runs the cmc command line, like the rest of
// the interface, and the pane redraws by itself when anything changes.
//
// Engine code only: no `node:` imports. Elements are built by calling them
// (`Box({ ... })`), which is what JSX compiles to.
import { cli, currentDataDir, markPendingInBox, onSendSettled, sendHeld, type HeldEntry, type InterfaceEngine } from './interface.ts';

export const PANE_ID = 'cmc';
const PANE_TITLE = 'cmc hub';
/** How often the pane checks the session files for changes. */
const REFRESH_MS = 1000;
/** How much of a message a row shows. */
const ROW_LENGTH = 64;
/** How many lines of activity are kept, and how many show under every view. */
const ACTIVITY_KEPT = 30;
const ACTIVITY_SHOWN = 2;

/**
 * The mark of the hub in the terminal (ADR 003 §8): "cmc" in half blocks,
 * two lines high. It stands where the logo goes until there is one.
 */
export const MARK = Object.freeze(['▄▀▀ █▀▄▀█ ▄▀▀', '▀▄▄ █ ▀ █ ▀▄▄']);
export const PRODUCT_NAME = 'Claude Message Control';
export const AUTHOR = 'by r3v3rs3';
/** Where "by r3v3rs3" leads: the author's GitHub. */
export const AUTHOR_URL = 'https://github.com/petersonsenadevs';

/** The palette (ADR 003 §4): accents only, so the panel sits well on any theme. */
export const COLORS = Object.freeze({ accent: '#7C5CFF', working: '#F5A524', done: '#2BB673', error: '#E5484D' });

/** An element as the engine builds it: plain data the module only passes on. */
export type Element = unknown;
type Children = Element | readonly Element[];
type Make<P> = (props: P & { children?: Children }) => Element;

/** The elements of a drawing surface the panel uses (the engine's own types are not available outside it). */
export interface PanelElements {
  Box: Make<{
    key?: string;
    flexDirection?: 'row' | 'column';
    gap?: number;
    columnGap?: number;
    marginTop?: number;
    marginLeft?: number;
    flexWrap?: 'wrap' | 'nowrap';
    borderStyle?: string;
    borderColor?: string;
    paddingX?: number;
    justifyContent?: 'flex-start' | 'flex-end' | 'center';
    width?: number | string;
  }>;
  Text: Make<{ bold?: boolean; dimColor?: boolean; color?: string; italic?: boolean; wrap?: 'truncate-end' | 'wrap'; maxLines?: number }>;
  Button: Make<{
    key: string;
    label: string;
    onPress: () => Promise<unknown> | void;
    dimColor?: boolean;
    variant?: 'primary' | 'secondary';
    plain?: true;
    hotkey?: string;
  }>;
  Select: Make<{ key: string; label?: string; value?: string; options: readonly { value: string; label?: string }[]; onSelect: (value: string) => void | Promise<unknown> }>;
  /** Its text is `label` (or its children); with neither, the terminal draws the URL itself. */
  Link: Make<{ key?: string; href: string; label?: string }>;
  Input: Make<{
    key: string;
    placeholder?: string;
    value?: string;
    submitLabel?: string;
    onInput?: (value: string) => void;
    onSubmit: (value: string) => void | Promise<unknown>;
  }>;
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
    close(pane: { id: string }): Promise<void>;
    panes(): Promise<readonly { id: string; isShown?: boolean }[]>;
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

export const PANEL_COMMAND = Object.freeze({ name: 'cmc', description: 'cmc: open or close the hub (messages, subagents, settings)', immediate: true } as const);

/** A subagent as `cmc agents --format json` gives it. */
export interface AgentEntry {
  id: string;
  task: string;
  state: string;
  mode: string;
  branch: string | null;
  worktreePath: string | null;
  changedFiles: string[];
  startedAt: string;
  endedAt: string | null;
  answer: string | null;
  model?: string;
  effort?: string;
}

/** The modes (ADR 003 §7): the setting, how the panel names it, and its two values. */
export const MODES = Object.freeze([
  {
    key: 'panelAutoOpen',
    label: 'Open the hub',
    values: [['true', 'Automatically'], ['false', 'Only with /cmc']],
    help: 'Whether this hub opens by itself when you hold a message or a subagent starts. /cmc opens and closes it either way.',
  },
  {
    key: 'sendAtEnd',
    label: 'Deliver',
    values: [['true', 'End of turn'], ['false', 'Hold']],
    help: 'What you hold while the agent works: it gets it when its turn ends, or it waits until you send it.',
  },
  {
    key: 'holdTarget',
    label: 'Typed ;; goes to',
    values: [['main', 'Main'], ['subagent', 'Subagent']],
    help: 'A message you type after ";;": held for the main agent, or handed to a new subagent so the main conversation stays clean.',
  },
  {
    key: 'dispatch.context',
    label: 'Subagent context',
    values: [['fork', 'Full'], ['pack', 'Summary']],
    help: 'What a new subagent knows: a copy of the whole conversation, or a short summary (cheaper, less to go on).',
  },
  {
    key: 'dispatch.return',
    label: 'Results',
    values: [['held', 'Hold'], ['auto', 'Auto']],
    help: "A subagent's answer: it waits here for you, or it goes to the main agent by itself when a turn ends.",
  },
] as const);

/** The model and effort selectors (ADR 003 §8): what each offers; "inherit" leaves it to the user's own setup. */
export const PICKERS = Object.freeze([
  {
    key: 'dispatch.model',
    label: 'Subagent model',
    values: ['inherit', 'fable', 'opus', 'sonnet', 'haiku'],
    help: 'The model new subagents run with. "Same as mine" follows your own Claude Code setup.',
  },
  {
    key: 'dispatch.effort',
    label: 'Effort',
    values: ['inherit', 'low', 'medium', 'high', 'xhigh', 'max'],
    help: 'How hard they think: lower is faster and cheaper, higher is more thorough.',
  },
] as const);

type View = 'messages' | 'agents' | 'activity' | 'settings';

/** One line on top of each view: what it is and what can be done in it. */
export const VIEW_HELP: Readonly<Record<View, string>> = Object.freeze({
  messages: 'What you hold for the agent. Click a message for its actions; type below to hold one without ";;".',
  agents: 'Subagents work apart, in their own worktree. Click one to see the conversation and write to it.',
  activity: 'What happened, newest first.',
  settings: 'How cmc behaves. Each change applies at once and is kept for next time.',
});

/** One line that says how the modes are set, under the header of every view but Settings. */
export function modesSummary(modes: Record<string, string>): string {
  const delivery = modes.sendAtEnd === 'false' ? 'held until you send' : 'delivered when the turn ends';
  const typed = modes.holdTarget === 'subagent' ? ';; starts a subagent' : ';; holds for the agent';
  const context = modes['dispatch.context'] === 'pack' ? 'summary' : 'whole conversation';
  const model = modes['dispatch.model'] && modes['dispatch.model'] !== 'inherit' ? `, ${modes['dispatch.model']}` : '';
  const effort = modes['dispatch.effort'] && modes['dispatch.effort'] !== 'inherit' ? `, effort ${modes['dispatch.effort']}` : '';
  return `Messages ${delivery} · ${typed} · subagents get the ${context}${model}${effort}`;
}

/** The plugin's version and repository, from its manifest; shown at the bottom right. */
export interface ManifestInfo {
  version: string | null;
  repository: string | null;
}

/** Reads the version and the repository (`repository`, or `homepage`) of the plugin's manifest. */
export function readManifest(text: string): ManifestInfo {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null) return { version: null, repository: null };
    const raw = value as Record<string, unknown>;
    const repository = typeof raw.repository === 'string' ? raw.repository : typeof raw.homepage === 'string' ? raw.homepage : null;
    return { version: typeof raw.version === 'string' ? raw.version : null, repository: repository !== null && /^https:\/\//.test(repository) ? repository : null };
  } catch {
    return { version: null, repository: null };
  }
}

/** What the person is looking at: kept while the session lasts (a reload of the module starts over). */
const ui = {
  view: 'messages' as View,
  /** The selected message or subagent, by id. */
  selected: null as string | null,
  /** The message being edited in its row, by id. */
  editing: null as string | null,
  /** What is typed in the hold box. */
  draft: '',
  activity: [] as { at: string; text: string; isError: boolean }[],
};

/** The plugin's version and repository, read when the session starts. */
let manifest: ManifestInfo = { version: null, repository: null };

/** Adds a line to the activity list. */
export function noteActivity(text: string, isError = false, now: Date = new Date()): void {
  const at = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  ui.activity = [{ at, text, isError }, ...ui.activity].slice(0, ACTIVITY_KEPT);
}

/** Starts over: for tests, and when the session starts. */
export function resetPanelState(): void {
  ui.view = 'messages';
  ui.selected = null;
  ui.editing = null;
  ui.draft = '';
  ui.activity = [];
}

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
  const from = entry.source.startsWith('agent ') ? ` (from ${entry.source.replace('agent ', 'subagent ')})` : '';
  return `${position}  ${short}${from}`;
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

/** The settings as the panel reads them (defaults when the file is missing or wrong). */
export function readModes(configText: string): Record<string, string> {
  const modes: Record<string, string> = {
    panelAutoOpen: 'true',
    sendAtEnd: 'true',
    holdTarget: 'main',
    'dispatch.context': 'fork',
    'dispatch.return': 'held',
    'dispatch.model': 'inherit',
    'dispatch.effort': 'inherit',
  };
  try {
    const value: unknown = JSON.parse(configText);
    if (typeof value !== 'object' || value === null) return modes;
    const raw = value as Record<string, unknown>;
    if (raw.sendAtEnd === false) modes.sendAtEnd = 'false';
    if (raw.panelAutoOpen === false) modes.panelAutoOpen = 'false';
    if (raw.holdTarget === 'subagent') modes.holdTarget = 'subagent';
    const dispatch = typeof raw.dispatch === 'object' && raw.dispatch !== null ? (raw.dispatch as Record<string, unknown>) : {};
    if (dispatch.context === 'pack') modes['dispatch.context'] = 'pack';
    if (dispatch.return === 'auto') modes['dispatch.return'] = 'auto';
    if (typeof dispatch.model === 'string' && dispatch.model !== '') modes['dispatch.model'] = dispatch.model;
    if (typeof dispatch.effort === 'string' && dispatch.effort !== '') modes['dispatch.effort'] = dispatch.effort;
  } catch {
    // Missing or damaged: the defaults, as the core uses them.
  }
  return modes;
}

/** Whether held messages go by themselves at the end of a turn (the sendAtEnd setting, true unless set to false). */
export function sendsAtEnd(configText: string): boolean {
  return readModes(configText).sendAtEnd === 'true';
}

/** The line next to the title: what the agent is doing, and so what Send does. */
export function statusLine(working: boolean, atEnd: boolean): string {
  if (!working) return '○ Agent idle · Send hands a message over now';
  return atEnd ? '● Agent working · held messages go to it when its turn ends' : '● Agent working · Send puts a message in the prompt box (Ctrl+Enter)';
}

/** What will happen to a held message, for its row. */
export function fateOf(entry: HeldEntry, working: boolean, atEnd: boolean): string {
  if (entry.source.startsWith('agent ')) return 'subagent result';
  if (working && atEnd) return 'goes when the turn ends';
  return 'held until you send it';
}

/** A subagent's age: how long it ran, or has been running. */
export function elapsed(startedAt: string, endedAt: string | null, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round(((endedAt === null ? now : Date.parse(endedAt)) - Date.parse(startedAt)) / 1000));
  if (Number.isNaN(seconds)) return '';
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

/** The icon and colour of a subagent's state. */
export function stateMark(state: string): { icon: string; color?: string } {
  if (state === 'running' || state === 'starting') return { icon: '⟳', color: COLORS.working };
  if (state === 'waiting') return { icon: '●', color: COLORS.accent };
  if (state === 'finished') return { icon: '✓', color: COLORS.done };
  if (state === 'failed' || state === 'lost') return { icon: '✗', color: COLORS.error };
  return { icon: '■' };
}

/** What the activity says after "To subagent": which subagent took the message, or why it could not. */
export function dispatchToast(receipt: string): string {
  const agent = receipt.match(/Dispatched to agent ([0-9a-f]+)/)?.[1];
  return agent === undefined
    ? firstSentence(receipt.trim())
    : `Subagent ${agent} took the message, with ${/inherits this conversation/.test(receipt) ? 'the whole conversation' : 'a summary of the conversation'} as context; it works apart and its result comes back here.`;
}

/** The first sentence of a command's answer, short enough for one line. */
export function firstSentence(text: string): string {
  const line = text.replace(/^\[cmc\]\s*/, '').split('\n')[0] ?? '';
  const end = line.search(/\.(\s|$)/);
  return end < 0 ? line : line.slice(0, end + 1);
}

/** One entry of a subagent's conversation, as its supervisor records it. */
export interface ChatEntry {
  at: string;
  role: 'you' | 'agent' | 'step' | 'aside' | 'note';
  text: string;
}

/** How many entries of a conversation the panel shows: the latest. */
const CHAT_SHOWN = 40;

/** Reads a conversation file's text; a line that cannot be read is skipped. */
export function parseConversation(text: string): ChatEntry[] {
  return text.split('\n').flatMap((line) => {
    try {
      const value: unknown = JSON.parse(line);
      if (typeof value !== 'object' || value === null) return [];
      const entry = value as Record<string, unknown>;
      const roles = ['you', 'agent', 'step', 'aside', 'note'];
      return typeof entry.text === 'string' && typeof entry.role === 'string' && roles.includes(entry.role)
        ? [{ at: typeof entry.at === 'string' ? entry.at : '', role: entry.role as ChatEntry['role'], text: entry.text }]
        : [];
    } catch {
      return [];
    }
  });
}

/** The time of an entry, for its bubble: hours and minutes. */
export function chatTime(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? '' : `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** Reads the agents list the command line prints; nothing when it cannot be read. */
export function parseAgents(text: string): AgentEntry[] {
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? (value as AgentEntry[]) : [];
  } catch {
    return [];
  }
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

/** The subagents read last, drawn when a newer read fails. */
let lastAgents: AgentEntry[] = [];

/**
 * The subagents of the session. The engine aborts a running `$.process.run`
 * when the pane is redrawn again; the draw then keeps the last list it read
 * instead of failing, which would print an error in the chat.
 */
async function agentsOf($: InterfaceEngine): Promise<AgentEntry[]> {
  try {
    lastAgents = parseAgents((await cli($, ['agents', '--format', 'json'])).stdout);
  } catch {
    // Aborted or failed: the last list stands until the next refresh.
  }
  return lastAgents;
}

/** Whether the hub is open now. */
async function isOpen($: PanelEngine): Promise<boolean> {
  try {
    return (await $.ui.panes()).some((pane) => pane.id === PANE_ID);
  } catch {
    return false;
  }
}

/** /cmc: opens the hub, or closes it when it is open. */
export async function togglePanel($: PanelEngine): Promise<string> {
  if (await isOpen($)) {
    await $.ui.close({ id: PANE_ID });
    return 'cmc hub closed. /cmc opens it again.';
  }
  return openPanel($);
}

/**
 * Whether the hub should open by itself: something new to look at (one more
 * message held, or one more subagent working) and the setting on.
 */
export function shouldAutoOpen(before: { held: number; working: number }, now: { held: number; working: number }, autoOpen: boolean): boolean {
  return autoOpen && (now.held > before.held || now.working > before.working);
}

/** How many subagents are working, from `agents/active.json`. */
export function activeCount(text: string): number {
  try {
    const value: unknown = JSON.parse(text);
    const active = typeof value === 'object' && value !== null && 'active' in value ? (value as { active: unknown }).active : 0;
    return typeof active === 'number' && active > 0 ? Math.floor(active) : 0;
  } catch {
    return 0;
  }
}

/** Opens the pane (or brings it forward); says so when the terminal has no room for it. */
export async function openPanel($: PanelEngine): Promise<string> {
  const placed = await $.ui.open({ id: PANE_ID, title: PANE_TITLE, closeOnEscape: true });
  return placed.isPlaced === false
    ? 'The cmc panel cannot be shown here: the terminal is too narrow, or the session has no screen. Widen the window, or use /held.'
    : 'cmc panel opened. Escape closes it.';
}

/** Starts the live refresh: the pane redraws when the queue, the state, the settings or the agents change. */
export async function startPanel($: PanelEngine): Promise<void> {
  await $.command.register(PANEL_COMMAND);
  try {
    manifest = readManifest(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`));
  } catch {
    manifest = { version: null, repository: null };
  }
  // A send finishes after its click: its outcome joins the activity when it does.
  onSendSettled((outcome, isError) => {
    noteActivity(outcome, isError);
    $.ui.invalidate('ui.render');
  });
  const snapshot = async () =>
    [await queueText($), await sessionFile($, 'state.json'), await sessionFile($, 'agents/active.json'), await settingsText($)].join('\n');
  const counts = async () => ({ held: parseQueue(await queueText($)).length, working: activeCount(await sessionFile($, 'agents/active.json')) });
  let lastCounts = await counts();
  let last = await snapshot();
  $.clock.every(REFRESH_MS, async () => {
    const now = await snapshot();
    // Something new to look at: the hub opens by itself (panelAutoOpen), unless it is open already.
    const nowCounts = await counts();
    if (shouldAutoOpen(lastCounts, nowCounts, readModes(await settingsText($)).panelAutoOpen !== 'false') && !(await isOpen($))) {
      await openPanel($).catch(() => undefined);
    }
    lastCounts = nowCounts;
    // A working subagent's clock moves every second, so a pane showing one redraws anyway.
    if (now !== last || ui.view === 'agents') {
      last = now;
      $.ui.invalidate('ui.render');
    }
  });
}

/** Runs one action, notes what it did, then redraws at once instead of waiting for the next refresh. */
async function act($: PanelEngine, action: () => Promise<string | null>): Promise<void> {
  try {
    const said = await action();
    if (said) noteActivity(said);
  } catch (error) {
    noteActivity(error instanceof Error ? error.message : String(error), true);
  }
  $.ui.invalidate('ui.render');
}

/** The current position of a message, found by id at the moment of the click (the queue may have moved). */
async function positionOf($: PanelEngine, id: string): Promise<string | null> {
  const index = parseQueue(await queueText($)).findIndex((entry) => entry.id === id);
  return index < 0 ? null : String(index + 1);
}

/**
 * Send (ADR 003 §3, D-038): with the agent idle, a new prompt at once; while it
 * works, the text goes into the prompt box for Ctrl+Enter, Claude Code's own
 * send-now, and leaves the queue when the person sends it.
 */
async function sendOne($: PanelEngine, id: string): Promise<string | null> {
  const entry = parseQueue(await queueText($)).find((one) => one.id === id);
  if (entry === undefined) return 'That message is no longer held.';
  if (!isWorking(await sessionFile($, 'state.json'))) {
    const at = await positionOf($, id);
    return at === null ? 'That message is no longer held.' : (await sendHeld($, [at])).text;
  }
  const box = await $.prompt.read();
  const empty = box.text.trim() === '';
  await $.prompt.fill({ text: empty ? entry.text : `\n${entry.text}`, mode: empty ? 'replace' : 'append' });
  markPendingInBox(id, entry.text);
  return 'In the prompt box: press Ctrl+Enter to send it now (Ctrl+X Ctrl+S if your terminal does not pass Ctrl+Enter).';
}

async function sendAll($: PanelEngine): Promise<string | null> {
  return (await sendHeld($, [])).text;
}

async function deleteOne($: PanelEngine, id: string): Promise<string | null> {
  await cli($, ['take', id]);
  if (ui.selected === id) ui.selected = null;
  return 'Deleted.';
}

async function moveOne($: PanelEngine, id: string, direction: 'up' | 'down'): Promise<string | null> {
  const at = await positionOf($, id);
  if (at === null) return 'That message is no longer held.';
  await cli($, [direction, at]);
  return null;
}

async function editOne($: PanelEngine, id: string, text: string): Promise<string | null> {
  ui.editing = null;
  const at = await positionOf($, id);
  if (at === null) return 'That message is no longer held.';
  if (text.trim() === '') return 'Not changed: the text was empty.';
  await cli($, ['edit', at], undefined, text);
  return 'Edited.';
}

/** Hands one held message to a new subagent, which works on it in its own context and worktree. */
async function toSubagent($: PanelEngine, id: string): Promise<string | null> {
  const at = await positionOf($, id);
  if (at === null) return 'That message is no longer held.';
  if (ui.selected === id) ui.selected = null;
  return dispatchToast((await cli($, ['dispatch', '--message', at])).stdout);
}

/** Holds what was typed in the box (or, in subagent mode, starts a subagent on it). */
async function holdTyped($: PanelEngine, text: string): Promise<string | null> {
  ui.draft = '';
  if (text.trim() === '') return null;
  const held = await cli($, ['hold', '--stdin', '--typed'], text);
  return /Dispatched to agent/.test(held.stdout) ? dispatchToast(held.stdout) : firstSentence(held.stdout.trim());
}

/** Starts a subagent on what was typed in the box, whatever the mode. */
async function dispatchTyped($: PanelEngine, text: string): Promise<string | null> {
  ui.draft = '';
  if (text.trim() === '') return 'Type the task first.';
  return dispatchToast((await cli($, ['dispatch'], undefined, text)).stdout);
}

async function clearAll($: PanelEngine): Promise<string | null> {
  await cli($, ['clear']);
  ui.selected = null;
  return 'Every held message was deleted.';
}

async function setModeTo($: PanelEngine, key: string, value: string, label: string): Promise<string | null> {
  const set = await cli($, ['config', 'set', key, value]);
  if (set.exitCode !== 0) return firstSentence(set.stdout.trim());
  return key.startsWith('dispatch.model') || key.startsWith('dispatch.effort') ? `${label} for new subagents.` : `${label} mode on.`;
}

/** Hands a finished subagent's result to the main agent: its message in the queue, sent like any other. */
async function resultToMain($: PanelEngine, agentId: string): Promise<string | null> {
  const index = parseQueue(await queueText($)).findIndex((entry) => entry.source === `agent ${agentId}`);
  if (index < 0) return 'Its result is no longer in the queue (already sent or deleted).';
  return (await sendHeld($, [String(index + 1)])).text;
}

/** Writes to a subagent: it reads it after its current step, or its closed session is resumed with it. */
async function tellOne($: PanelEngine, agentId: string, text: string): Promise<string | null> {
  if (text.trim() === '') return null;
  const told = await cli($, ['tell', agentId, '--stdin'], text);
  return firstSentence(told.stdout.trim());
}

async function stopAgent($: PanelEngine, agentId: string): Promise<string | null> {
  return firstSentence((await cli($, ['cancel', agentId])).stdout.trim());
}

function select(id: string): Promise<string | null> {
  ui.selected = ui.selected === id ? null : id;
  ui.editing = null;
  return Promise.resolve(null);
}

function show(view: View): Promise<string | null> {
  ui.view = view;
  ui.selected = null;
  ui.editing = null;
  return Promise.resolve(null);
}

function startEditing(id: string): Promise<string | null> {
  ui.editing = id;
  return Promise.resolve(null);
}

/** The title row: name, the agent's state, and the tabs. */
function drawHeader(el: PanelElements, $: PanelEngine, working: boolean, atEnd: boolean, held: number, agents: AgentEntry[]): Element {
  const { Box, Text, Button, Link } = el;
  const live = agents.filter((agent) => agent.state === 'running' || agent.state === 'starting').length;
  const tab = (view: View, label: string, hotkey: string) =>
    Button({ key: `tab-${view}`, label, hotkey, ...(ui.view === view ? { variant: 'primary' as const } : { dimColor: true }), onPress: () => act($, () => show(view)) });
  return Box({
    flexDirection: 'column',
    children: [
      // The mark (the logo's place), the name and the author, then the agent's state.
      Box({
        key: 'brand',
        flexDirection: 'row',
        columnGap: 3,
        children: [
          Box({ flexDirection: 'column', children: MARK.map((line) => Text({ bold: true, color: COLORS.accent, children: line })) }),
          Box({ flexDirection: 'column', children: [Text({ bold: true, children: PRODUCT_NAME }), Link({ key: 'author', href: AUTHOR_URL, label: AUTHOR })] }),
        ],
      }),
      Text({ color: working ? COLORS.working : COLORS.done, children: statusLine(working, atEnd) }),
      Box({
        flexDirection: 'row',
        columnGap: 1,
        children: [tab('messages', `Messages ${held}`, '1'), tab('agents', `Subagents ${agents.length}${live > 0 ? ` (${live} working)` : ''}`, '2'), tab('activity', 'Activity', '3'), tab('settings', 'Settings', '4')],
      }),
    ],
  });
}

/** How a model or effort value reads in its selector. */
export function pickerLabel(value: string): string {
  return value === 'inherit' ? 'Same as mine' : value;
}

/** The model and effort of a subagent, for its row: nothing when both follow the user's setup. */
export function modelAndEffort(model = 'inherit', effort = 'inherit'): string {
  const parts = [model === 'inherit' ? null : model, effort === 'inherit' ? null : `effort ${effort}`].filter((part) => part !== null);
  return parts.length === 0 ? '' : ` · ${parts.join(' · ')}`;
}

/** The strip of modes: each a pair of buttons, the one in force drawn as primary; then the model and effort selectors. */
function drawModes(el: PanelElements, $: PanelEngine, modes: Record<string, string>): Element {
  const { Box, Text, Button, Select } = el;
  const switches = MODES.map((mode) =>
    Box({
      key: `mode-${mode.key}`,
      flexDirection: 'column',
      children: [
        Box({
          flexDirection: 'row',
          columnGap: 1,
          children: [
            Text({ bold: true, children: `${mode.label}:` }),
            ...mode.values.map(([value, label]) =>
              modes[mode.key] === value
                ? Button({ key: `mode-${mode.key}-${value}`, label, variant: 'primary', onPress: () => undefined })
                : Button({ key: `mode-${mode.key}-${value}`, label, dimColor: true, onPress: () => act($, () => setModeTo($, mode.key, value, label)) }),
            ),
          ],
        }),
        Text({ dimColor: true, wrap: 'wrap', children: mode.help }),
      ],
    }),
  );
  const pickers = PICKERS.map((picker) => {
    const current = modes[picker.key] ?? 'inherit';
    // A full model name from the settings file is offered too, so it shows as chosen.
    const values: readonly string[] = (picker.values as readonly string[]).includes(current) ? picker.values : [...picker.values, current];
    return Box({
      key: `picker-${picker.key}`,
      flexDirection: 'column',
      children: [
        Select({
          key: `pick-${picker.key}`,
          label: picker.label,
          value: current,
          options: values.map((value) => ({ value, label: pickerLabel(value) })),
          onSelect: (value) => act($, () => setModeTo($, picker.key, value, `${picker.label} ${pickerLabel(value)}`)),
        }),
        Text({ dimColor: true, wrap: 'wrap', children: picker.help }),
      ],
    });
  });
  return Box({ flexDirection: 'column', gap: 1, children: [...switches, ...pickers] });
}

function drawMessages(el: PanelElements, $: PanelEngine, entries: HeldEntry[], working: boolean, atEnd: boolean, typedTo: string): Element {
  const { Box, Text, Button, Input } = el;
  const rows = entries.map((entry, index) => {
    const isSelected = ui.selected === entry.id;
    const line = Box({
      key: `row-${entry.id}`,
      flexDirection: 'row',
      columnGap: 1,
      children: [
        Text({ color: isSelected ? COLORS.accent : undefined, children: isSelected ? '▸' : ' ' }),
        Button({ key: `pick-${entry.id}`, label: rowText(index + 1, entry), plain: true, onPress: () => act($, () => select(entry.id)) }),
        Text({ dimColor: true, children: `· ${fateOf(entry, working, atEnd)}` }),
      ],
    });
    if (!isSelected) return line;
    const actions =
      ui.editing === entry.id
        ? Input({ key: `edit-${entry.id}`, value: entry.text, submitLabel: 'Save', onSubmit: (value) => act($, () => editOne($, entry.id, value)) })
        : Box({
            flexDirection: 'row',
            columnGap: 1,
            flexWrap: 'wrap',
            children: [
              Button({ key: `send-${entry.id}`, label: 'Send now', variant: 'primary', hotkey: 's', onPress: () => act($, () => sendOne($, entry.id)) }),
              Button({ key: `agent-${entry.id}`, label: 'To subagent', hotkey: 'a', onPress: () => act($, () => toSubagent($, entry.id)) }),
              Button({ key: `edit-${entry.id}`, label: 'Edit', hotkey: 'e', onPress: () => act($, () => startEditing(entry.id)) }),
              Button({ key: `up-${entry.id}`, label: '↑', dimColor: true, onPress: () => act($, () => moveOne($, entry.id, 'up')) }),
              Button({ key: `down-${entry.id}`, label: '↓', dimColor: true, onPress: () => act($, () => moveOne($, entry.id, 'down')) }),
              Button({ key: `delete-${entry.id}`, label: 'Delete', hotkey: 'd', dimColor: true, onPress: () => act($, () => deleteOne($, entry.id)) }),
            ],
          });
    return Box({ key: `sel-${entry.id}`, flexDirection: 'column', children: [line, Box({ marginLeft: 4, children: actions })] });
  });
  const list =
    entries.length === 0
      ? Text({ dimColor: true, children: 'Nothing is held. Type below, or ";; message" in the chat while the agent works.' })
      : Box({ flexDirection: 'column', children: rows });
  const bulk =
    entries.length === 0
      ? null
      : Box({
          flexDirection: 'row',
          columnGap: 1,
          children: [
            Button({ key: 'send-all', label: 'Send all', onPress: () => act($, () => sendAll($)) }),
            Button({ key: 'clear', label: 'Clear', dimColor: true, onPress: () => act($, () => clearAll($)) }),
          ],
        });
  const box = Box({
    flexDirection: 'column',
    children: [
      Input({
        key: 'hold-box',
        placeholder: typedTo === 'subagent' ? 'Type a task: it goes to a new subagent' : 'Type a message to hold for the agent',
        value: ui.draft,
        submitLabel: typedTo === 'subagent' ? 'To subagent' : 'Hold',
        onInput: (value) => {
          ui.draft = value;
        },
        onSubmit: (value) => act($, () => holdTyped($, value)),
      }),
    ],
  });
  return Box({ flexDirection: 'column', gap: 1, children: [list, bulk, box] });
}

/** What a new subagent will run with, for the new-task box. */
export function newTaskHint(modes: Record<string, string>): string {
  const context = modes['dispatch.context'] === 'pack' ? 'a summary of this conversation' : 'this whole conversation';
  return `It gets ${context}${modelAndEffort(modes['dispatch.model'], modes['dispatch.effort']).replace(/^ · /, ', runs with ').replace(' · ', ', ')}. Change it in Settings.`;
}

/** The new-task box, on top of the Subagents view. */
function drawNewTask(el: PanelElements, $: PanelEngine, modes: Record<string, string>): Element {
  const { Box, Text, Input } = el;
  return Box({
    key: 'new-task',
    flexDirection: 'column',
    children: [
      Text({ bold: true, children: 'New subagent task' }),
      Input({
        key: 'new-task-box',
        placeholder: 'What should a new subagent do? It works apart, in its own worktree.',
        submitLabel: 'Start',
        onSubmit: (value) => act($, () => dispatchTyped($, value)),
      }),
      Text({ dimColor: true, wrap: 'wrap', children: newTaskHint(modes) }),
    ],
  });
}

function drawAgents(el: PanelElements, $: PanelEngine, agents: AgentEntry[], held: HeldEntry[], chat: ChatEntry[], modes: Record<string, string>): Element {
  const { Box, Text, Button, Input } = el;
  const newTask = drawNewTask(el, $, modes);
  if (agents.length === 0) {
    return Box({
      flexDirection: 'column',
      gap: 1,
      children: [newTask, Text({ dimColor: true, children: 'No subagents yet. Start one above, or press "To subagent" on a held message.' })],
    });
  }
  const rows = agents.map((agent) => {
    const mark = stateMark(agent.state);
    const isSelected = ui.selected === agent.id;
    const line = Box({
      key: `agent-row-${agent.id}`,
      flexDirection: 'row',
      columnGap: 1,
      children: [
        Text({ color: mark.color, children: mark.icon }),
        Button({
          key: `agent-pick-${agent.id}`,
          label: `${agent.id}  ${agent.task.replace(/\s+/g, ' ').slice(0, ROW_LENGTH)}`,
          plain: true,
          onPress: () => act($, () => select(agent.id)),
        }),
        Text({
          dimColor: true,
          children: `· ${agent.state} · ${elapsed(agent.startedAt, agent.endedAt)} · ${agent.mode === 'fork' ? 'whole conversation' : 'summary'}${modelAndEffort(agent.model, agent.effort)}`,
        }),
      ],
    });
    if (!isSelected) return line;
    const working = agent.state === 'running' || agent.state === 'starting';
    const open = working || agent.state === 'waiting';
    const resultHeld = held.some((entry) => entry.source === `agent ${agent.id}`);
    const entries = (chat.length > 0 ? chat : [{ at: agent.startedAt, role: 'you' as const, text: agent.task }]).slice(-CHAT_SHOWN);
    const bubble = (entry: ChatEntry, index: number): Element => {
      const time = chatTime(entry.at);
      if (entry.role === 'step') return Box({ key: `chat-${index}`, children: Text({ dimColor: true, wrap: 'truncate-end', children: `   › ${entry.text}` }) });
      if (entry.role === 'note') return Box({ key: `chat-${index}`, children: Text({ dimColor: true, italic: true, children: `   — ${entry.text}` }) });
      const mine = entry.role === 'you';
      return Box({
        key: `chat-${index}`,
        flexDirection: 'row',
        justifyContent: mine ? 'flex-end' : 'flex-start',
        children: Box({
          flexDirection: 'column',
          width: '85%',
          borderStyle: 'round',
          borderColor: mine ? COLORS.accent : entry.role === 'aside' ? undefined : COLORS.done,
          paddingX: 1,
          children: [
            Text({ bold: true, color: mine ? COLORS.accent : COLORS.done, dimColor: entry.role === 'aside', children: `${mine ? 'You' : entry.role === 'aside' ? 'Agent (to your hooks)' : 'Agent'}${time === '' ? '' : `  ${time}`}` }),
            Text({ wrap: 'wrap', dimColor: entry.role === 'aside', children: entry.text }),
          ],
        }),
      });
    };
    const conversation = Box({
      flexDirection: 'column',
      marginLeft: 2,
      gap: 1,
      children: [
        Text({
          dimColor: true,
          children: `Sent with ${agent.mode === 'fork' ? 'the whole conversation' : 'a summary of the conversation'} as context${agent.branch ? ` · branch ${agent.branch}` : ''}${agent.changedFiles.length > 0 ? ` · changed: ${agent.changedFiles.join(', ')}` : ''}`,
        }),
        Box({ flexDirection: 'column', children: entries.map(bubble) }),
        working ? Text({ color: COLORS.working, children: `⟳ working for ${elapsed(agent.startedAt, null)}…` }) : null,
        agent.state === 'waiting' ? Text({ color: COLORS.accent, children: '● waiting for you: write below, or it closes after a while' }) : null,
        agent.state === 'cancelled'
          ? null
          : Input({
              key: `tell-${agent.id}`,
              placeholder: working ? `Write to ${agent.id}: it reads it after its current step` : open ? `Write to ${agent.id}` : `Write to ${agent.id}: its session is resumed`,
              submitLabel: 'Send',
              onSubmit: (value) => act($, () => tellOne($, agent.id, value)),
            }),
        Box({
          flexDirection: 'row',
          columnGap: 1,
          flexWrap: 'wrap',
          children: [
            resultHeld
              ? Button({ key: `to-main-${agent.id}`, label: 'Send result to main', variant: 'primary', onPress: () => act($, () => resultToMain($, agent.id)) })
              : null,
            open ? Button({ key: `stop-${agent.id}`, label: 'Stop', dimColor: true, onPress: () => act($, () => stopAgent($, agent.id)) }) : null,
          ],
        }),
      ],
    });
    return Box({ key: `agent-sel-${agent.id}`, flexDirection: 'column', children: [line, conversation] });
  });
  return Box({ flexDirection: 'column', gap: 1, children: [newTask, Box({ flexDirection: 'column', children: rows })] });
}

function drawActivity(el: PanelElements, limit: number): Element {
  const { Box, Text } = el;
  const lines = ui.activity.slice(0, limit);
  if (lines.length === 0) return Text({ dimColor: true, children: 'Nothing has happened yet.' });
  return Box({
    flexDirection: 'column',
    children: lines.map((line, index) =>
      Box({
        key: `activity-${index}`,
        flexDirection: 'row',
        columnGap: 1,
        children: [Text({ dimColor: true, children: line.at }), Text({ color: line.isError ? COLORS.error : undefined, wrap: 'truncate-end', children: line.text })],
      }),
    ),
  });
}

/** Bottom right: the version, and the repository once the manifest names one. */
function drawFooter(el: PanelElements): Element {
  const { Box, Text, Link } = el;
  if (manifest.version === null && manifest.repository === null) return null;
  return Box({
    key: 'footer',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    columnGap: 2,
    children: [
      manifest.version === null ? null : Text({ dimColor: true, children: `v${manifest.version}` }),
      manifest.repository === null ? null : Link({ key: 'repo', href: manifest.repository, label: manifest.repository.replace(/^https:\/\//, '') }),
    ],
  });
}

/** Draws the pane from the session as it is now. */
export async function drawPanel($: PanelEngine, e: PaneRenderEvent): Promise<Element> {
  const el = $.ui.resolve(e);
  const { Box, Text } = el;
  const entries = parseQueue(await queueText($));
  const working = isWorking(await sessionFile($, 'state.json'));
  const modes = readModes(await settingsText($));
  const atEnd = modes.sendAtEnd === 'true';
  const agents = await agentsOf($);
  const body =
    ui.view === 'settings'
      ? drawModes(el, $, modes)
      : ui.view === 'agents'
      ? drawAgents(el, $, agents, entries, ui.selected === null ? [] : parseConversation(await sessionFile($, `agents/${ui.selected}/conversation.jsonl`)), modes)
      : ui.view === 'activity'
        ? drawActivity(el, ACTIVITY_KEPT)
        : drawMessages(el, $, entries, working, atEnd, modes.holdTarget ?? 'main');
  const recent =
    ui.view === 'activity' || ui.activity.length === 0
      ? null
      : Box({ flexDirection: 'column', children: [Text({ dimColor: true, children: '─ Latest' }), drawActivity(el, ACTIVITY_SHOWN)] });
  const help = Box({
    flexDirection: 'column',
    children: [
      Text({ dimColor: true, wrap: 'wrap', children: VIEW_HELP[ui.view] }),
      ui.view === 'settings' ? null : Text({ dimColor: true, italic: true, wrap: 'wrap', children: modesSummary(modes) }),
    ],
  });
  return Box({ flexDirection: 'column', gap: 1, children: [drawHeader(el, $, working, atEnd, entries.length, agents), help, body, recent, drawFooter(el)] });
}

export const register = (on: PanelOn): void => {
  on('command.run', { command: PANEL_COMMAND.name }, async ($) => ({ text: await togglePanel($), isTextDisplayOnly: true }));
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => drawPanel($, e));
};
