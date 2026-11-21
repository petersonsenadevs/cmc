// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// The control panel (ADR 003): a pane beside the chat, drawn by Claude Code's
// own plugin engine, from which everything is controlled: the agent's state,
// the held messages, the subagents with their conversation, the modes, and
// what just happened. Every action runs the cmc command line, like the rest of
// the interface, and the pane redraws by itself when anything changes.
//
// Engine code only: no `node:` imports. Elements are built by calling them
// (`Box({ ... })`), which is what JSX compiles to.
import { cli, currentDataDir, markPendingInBox, sendHeld, type HeldEntry, type InterfaceEngine } from './interface.ts';

export const PANE_ID = 'cmc';
const PANE_TITLE = 'cmc';
/** How often the pane checks the session files for changes. */
const REFRESH_MS = 1000;
/** How much of a message a row shows. */
const ROW_LENGTH = 64;
/** How many lines of activity are kept, and how many show under every view. */
const ACTIVITY_KEPT = 30;
const ACTIVITY_SHOWN = 2;

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

export const PANEL_COMMAND = Object.freeze({ name: 'cmc', description: 'cmc: open the control panel (messages, subagents, modes)', immediate: true } as const);

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
}

/** The modes (ADR 003 §7): the setting, how the panel names it, and its two values. */
export const MODES = Object.freeze([
  { key: 'sendAtEnd', label: 'Deliver', values: [['true', 'End of turn'], ['false', 'Hold']] },
  { key: 'holdTarget', label: 'Typed ;; goes to', values: [['main', 'Main'], ['subagent', 'Subagent']] },
  { key: 'dispatch.context', label: 'Subagent context', values: [['fork', 'Full'], ['pack', 'Summary']] },
  { key: 'dispatch.return', label: 'Results', values: [['held', 'Hold'], ['auto', 'Auto']] },
] as const);

type View = 'messages' | 'agents' | 'activity';

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
  const modes: Record<string, string> = { sendAtEnd: 'true', holdTarget: 'main', 'dispatch.context': 'fork', 'dispatch.return': 'held' };
  try {
    const value: unknown = JSON.parse(configText);
    if (typeof value !== 'object' || value === null) return modes;
    const raw = value as Record<string, unknown>;
    if (raw.sendAtEnd === false) modes.sendAtEnd = 'false';
    if (raw.holdTarget === 'subagent') modes.holdTarget = 'subagent';
    const dispatch = typeof raw.dispatch === 'object' && raw.dispatch !== null ? (raw.dispatch as Record<string, unknown>) : {};
    if (dispatch.context === 'pack') modes['dispatch.context'] = 'pack';
    if (dispatch.return === 'auto') modes['dispatch.return'] = 'auto';
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

async function agentsOf($: InterfaceEngine): Promise<AgentEntry[]> {
  return parseAgents((await cli($, ['agents', '--format', 'json'])).stdout);
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
  const snapshot = async () =>
    [await queueText($), await sessionFile($, 'state.json'), await sessionFile($, 'agents/active.json'), await settingsText($)].join('\n');
  let last = await snapshot();
  $.clock.every(REFRESH_MS, async () => {
    const now = await snapshot();
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
  return set.exitCode === 0 ? `${label} mode on.` : firstSentence(set.stdout.trim());
}

/** Hands a finished subagent's result to the main agent: its message in the queue, sent like any other. */
async function resultToMain($: PanelEngine, agentId: string): Promise<string | null> {
  const index = parseQueue(await queueText($)).findIndex((entry) => entry.source === `agent ${agentId}`);
  if (index < 0) return 'Its result is no longer in the queue (already sent or deleted).';
  return (await sendHeld($, [String(index + 1)])).text;
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
  const { Box, Text, Button } = el;
  const live = agents.filter((agent) => agent.state === 'running' || agent.state === 'starting').length;
  const tab = (view: View, label: string, hotkey: string) =>
    Button({ key: `tab-${view}`, label, hotkey, ...(ui.view === view ? { variant: 'primary' as const } : { dimColor: true }), onPress: () => act($, () => show(view)) });
  return Box({
    flexDirection: 'column',
    children: [
      Box({
        flexDirection: 'row',
        columnGap: 2,
        children: [
          Text({ bold: true, color: COLORS.accent, children: 'cmc' }),
          Text({ color: working ? COLORS.working : COLORS.done, children: statusLine(working, atEnd) }),
        ],
      }),
      Box({
        flexDirection: 'row',
        columnGap: 1,
        children: [tab('messages', `Messages ${held}`, '1'), tab('agents', `Subagents ${agents.length}${live > 0 ? ` (${live} working)` : ''}`, '2'), tab('activity', 'Activity', '3')],
      }),
    ],
  });
}

/** The strip of modes: each a pair of buttons, the one in force drawn as primary. */
function drawModes(el: PanelElements, $: PanelEngine, modes: Record<string, string>): Element {
  const { Box, Text, Button } = el;
  return Box({
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 2,
    children: MODES.map((mode) =>
      Box({
        key: `mode-${mode.key}`,
        flexDirection: 'row',
        columnGap: 1,
        children: [
          Text({ dimColor: true, children: `${mode.label}:` }),
          ...mode.values.map(([value, label]) =>
            modes[mode.key] === value
              ? Button({ key: `mode-${mode.key}-${value}`, label, variant: 'primary', onPress: () => undefined })
              : Button({ key: `mode-${mode.key}-${value}`, label, dimColor: true, onPress: () => act($, () => setModeTo($, mode.key, value, label)) }),
          ),
        ],
      }),
    ),
  });
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
      Button({ key: 'box-to-subagent', label: 'Send what I typed to a subagent', dimColor: true, onPress: () => act($, () => dispatchTyped($, ui.draft)) }),
    ],
  });
  return Box({ flexDirection: 'column', gap: 1, children: [list, bulk, box] });
}

function drawAgents(el: PanelElements, $: PanelEngine, agents: AgentEntry[], held: HeldEntry[]): Element {
  const { Box, Text, Button } = el;
  if (agents.length === 0) {
    return Text({ dimColor: true, children: 'No subagents yet. Select a message and press "To subagent", or type a task in Messages.' });
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
        Text({ dimColor: true, children: `· ${agent.state} · ${elapsed(agent.startedAt, agent.endedAt)} · ${agent.mode === 'fork' ? 'whole conversation' : 'summary'}` }),
      ],
    });
    if (!isSelected) return line;
    const working = agent.state === 'running' || agent.state === 'starting';
    const resultHeld = held.some((entry) => entry.source === `agent ${agent.id}`);
    const conversation = Box({
      flexDirection: 'column',
      marginLeft: 2,
      borderStyle: 'round',
      borderColor: COLORS.accent,
      paddingX: 1,
      children: [
        Text({ dimColor: true, children: `Sent with ${agent.mode === 'fork' ? 'the whole conversation' : 'a summary of the conversation'} as context` }),
        Box({ flexDirection: 'row', columnGap: 1, children: [Text({ bold: true, color: COLORS.accent, children: 'You  ' }), Text({ wrap: 'wrap', children: agent.task })] }),
        working
          ? Text({ color: COLORS.working, children: `⟳ working for ${elapsed(agent.startedAt, null)}…` })
          : Box({
              flexDirection: 'row',
              columnGap: 1,
              children: [Text({ bold: true, color: mark.color, children: 'Agent' }), Text({ wrap: 'wrap', children: agent.answer ?? `(${agent.state}, no answer)` })],
            }),
        agent.branch ? Text({ dimColor: true, children: `Branch ${agent.branch}${agent.changedFiles.length > 0 ? ` · changed: ${agent.changedFiles.join(', ')}` : ' · no changes'}` }) : null,
        Box({
          flexDirection: 'row',
          columnGap: 1,
          flexWrap: 'wrap',
          children: [
            working ? Button({ key: `stop-${agent.id}`, label: 'Stop', onPress: () => act($, () => stopAgent($, agent.id)) }) : null,
            !working && resultHeld
              ? Button({ key: `to-main-${agent.id}`, label: 'Send result to main', variant: 'primary', onPress: () => act($, () => resultToMain($, agent.id)) })
              : null,
          ],
        }),
      ],
    });
    return Box({ key: `agent-sel-${agent.id}`, flexDirection: 'column', children: [line, conversation] });
  });
  return Box({ flexDirection: 'column', children: rows });
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
    ui.view === 'agents'
      ? drawAgents(el, $, agents, entries)
      : ui.view === 'activity'
        ? drawActivity(el, ACTIVITY_KEPT)
        : drawMessages(el, $, entries, working, atEnd, modes.holdTarget ?? 'main');
  const footer =
    ui.view === 'activity' || ui.activity.length === 0
      ? null
      : Box({ flexDirection: 'column', children: [Text({ dimColor: true, children: '─ Activity' }), drawActivity(el, ACTIVITY_SHOWN)] });
  return Box({ flexDirection: 'column', gap: 1, children: [drawHeader(el, $, working, atEnd, entries.length, agents), drawModes(el, $, modes), body, footer] });
}

export const register = (on: PanelOn): void => {
  on('command.run', { command: PANEL_COMMAND.name }, async ($) => ({ text: await openPanel($), isTextDisplayOnly: true }));
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => drawPanel($, e));
};
