// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// The interactive interface, inside Claude Code's plugin engine:
//  - a prompt that starts with the hold prefix and a space is held the moment
//    Enter is pressed, and leaves the prompt box with a short notice;
//  - /held opens a menu: pick a message, then send, edit, delete it or hand it
//    to an agent; /send sends them. Both run at once, even while the agent
//    works, and the agent never sees them;
//  - when a turn ends with messages still held, one line says so.
//
// This file runs in the engine, not in Node: no `node:` imports. Everything that
// touches the queue goes through the cmc command line (`bin/cmc.ts`), so the
// lock, the atomic writes and the rules of the core are the same as everywhere.
// If anything here fails, the prompt goes on to the command hooks beneath,
// which hold it the old way: a message is never lost because of this layer.

import { countHeld } from './indicator.ts';

const DEFAULT_HOLD_PREFIX = ';;';
/** How much of a message a menu option shows. */
const LABEL_LENGTH = 48;
/** How long after its command answers /send submits the prompt. */
const SUBMIT_DELAY_MS = 300;

/** The result of a command run through `$.process.run`. */
export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** The parts of the engine's `$` this module uses (the engine's own types are not available outside it). */
export interface InterfaceEngine {
  session: { id(): string | Promise<string> };
  plugin: { root: string };
  process: {
    hookEnv(): Record<string, string | undefined> | Promise<Record<string, string | undefined>>;
    run(argv: readonly string[], init?: { stdin?: string; timeoutMs?: number }): Promise<RunResult>;
  };
  fs: { read(path: string): string | Promise<string> };
  clock: { sleep(ms: number): Promise<void> };
  ui: {
    ask(question: string, options: { options: readonly string[]; header?: string }): Promise<string>;
    log(text: string): void;
  };
  prompt: {
    read(): Promise<{ text: string; cursor: number }>;
    fill(args: { text: string }): Promise<unknown>;
    submit(args: { text: string }): Promise<unknown>;
  };
  command: { register(spec: { name: string; description: string; argumentHint?: string; immediate?: true }): Promise<unknown> };
}

/** What `prompt.submit` hands a hook. */
export interface PromptSubmitEvent {
  text: string;
  command?: unknown;
  isMeta?: true;
}

/** What `turn.complete` hands a hook: why the turn ended. */
export interface TurnCompleteEvent {
  reason: string;
}

/** What `command.run` hands a hook. */
export interface CommandRunEvent {
  command: string;
  args: string;
}

/** A command answered by the plugin itself: for the person only, nothing for the model. */
export interface CommandAnswer {
  text: string;
  isTextDisplayOnly: true;
}

type Next<E, R> = (event: E) => Promise<R>;

export type InterfaceOn = {
  (event: 'prompt.submit', handler: ($: InterfaceEngine, e: PromptSubmitEvent, next: Next<PromptSubmitEvent, unknown>) => Promise<unknown>): void;
  (event: 'command.run', handler: ($: InterfaceEngine, e: CommandRunEvent, next: Next<CommandRunEvent, unknown>) => Promise<unknown>): void;
  (event: 'turn.complete', handler: ($: InterfaceEngine, e: TurnCompleteEvent, next: Next<TurnCompleteEvent, unknown>) => Promise<unknown>): void;
};

export const COMMANDS = Object.freeze([
  { name: 'held', description: 'cmc: your held messages: send, edit, delete or hand one to an agent', immediate: true },
  {
    name: 'send',
    description: 'cmc: send held messages now if the agent is idle, or when its turn ends',
    argumentHint: '[N …]',
    immediate: true,
  },
] as const);

/** The hold prefix in force: from the settings file when it sets a valid one. */
export function holdPrefixFrom(settingsText: string | null): string {
  if (settingsText === null) return DEFAULT_HOLD_PREFIX;
  try {
    const value: unknown = JSON.parse(settingsText);
    const prefix = typeof value === 'object' && value !== null && 'holdPrefix' in value ? value.holdPrefix : undefined;
    // The same rule as lib/config.ts: 1 to 4 symbols.
    return typeof prefix === 'string' && /^[^\sA-Za-z0-9/]{1,4}$/.test(prefix) ? prefix : DEFAULT_HOLD_PREFIX;
  } catch {
    return DEFAULT_HOLD_PREFIX;
  }
}

/**
 * The text to hold, when a prompt is a message to hold: the prefix followed by
 * whitespace. Without the space it is a control word (";;list"), which the
 * command hooks answer as before.
 */
export function messageToHold(prompt: string, prefix: string): string | null {
  if (!prompt.startsWith(prefix)) return null;
  const rest = prompt.slice(prefix.length);
  if (!/^\s/.test(rest) || rest.trim() === '') return null;
  return rest.trim();
}

/** Positions typed after /send: none means all; anything else is not a list of positions. */
export function positionsFrom(args: string): string[] | null {
  const words = args.trim().split(/\s+/).filter((word) => word !== '');
  return words.every((word) => /^[1-9]\d{0,5}$/.test(word)) ? words : null;
}

const display = (text: string): CommandAnswer => ({ text, isTextDisplayOnly: true });

/** A held message as `cmc list --format json` gives it. */
export interface HeldEntry {
  id: string;
  text: string;
  source: string;
}

/** One line of a message, short enough for a menu option. */
export function labelFor(position: number, text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return `${position} · ${line.length > LABEL_LENGTH ? `${line.slice(0, LABEL_LENGTH - 1)}…` : line}`;
}

export const ACTIONS = Object.freeze(['Send', 'Edit', 'Delete', 'Hand to an agent'] as const);

/** The options of the first menu: up to three messages, and "Send all" when there are several. */
export function pickOptions(entries: readonly HeldEntry[]): string[] {
  const shown = entries.slice(0, 3).map((entry, index) => labelFor(index + 1, entry.text));
  return entries.length > 1 ? [...shown, `Send all ${entries.length}`] : shown;
}

/**
 * What the person chose in the first menu: a position, every message, or
 * nothing usable. A number typed under "Other" picks a message the menu could
 * not show.
 */
export function readPick(answer: string, entries: readonly HeldEntry[]): number | 'all' | null {
  if (answer.startsWith('Send all ')) return 'all';
  const options = pickOptions(entries);
  const index = options.indexOf(answer);
  if (index >= 0 && index < Math.min(3, entries.length)) return index + 1;
  const typed = answer.trim().match(/^#?(\d{1,6})$/);
  const position = typed ? Number(typed[1]) : NaN;
  return position >= 1 && position <= entries.length ? position : null;
}

/** The one-line notice for a held message, from the receipt of `cmc hold`. */
export function noticeFor(receipt: string): string {
  const count = receipt.match(/Held \((\d+) queued\)/)?.[1] ?? '?';
  return /when its turn ends/.test(receipt)
    ? `cmc: held (${count}) · goes to the agent when its turn ends · /held to change it`
    : `cmc: held (${count}) · /held or /send to send it`;
}

/** The reminder shown when a turn ends with messages still held. */
export function reminderFor(held: number): string | null {
  if (held <= 0) return null;
  const noun = held === 1 ? 'message is' : 'messages are';
  return `cmc: ${held} ${noun} still held. /held to send, edit or delete, /send to send all.`;
}

/** The plugin data folder, known once the session has started. */
let dataDir: string | undefined;

/** Starts the interface for a session: called once, from the session start of the module. */
export async function startInterface($: InterfaceEngine): Promise<void> {
  ({ CLAUDE_PLUGIN_DATA: dataDir } = await $.process.hookEnv());
  for (const spec of COMMANDS) await $.command.register(spec);
}

/** Runs the cmc command line for this session; `stdin` is written to its standard input. */
async function cli($: InterfaceEngine, args: readonly string[], stdin?: string, text?: string): Promise<RunResult> {
  const sessionId = await $.session.id();
  // Options first, so a text that starts with "--" is not read as one.
  const argv = ['node', `${$.plugin.root}/bin/cmc.ts`, ...args, '--data-dir', dataDir ?? '', '--session', sessionId, ...(text === undefined ? [] : ['--', text])];
  return $.process.run(argv, { timeoutMs: 15000, ...(stdin === undefined ? {} : { stdin }) });
}

/** The hold prefix in force, read from the settings file each time (it may change). */
async function prefix($: InterfaceEngine): Promise<string> {
  try {
    return holdPrefixFrom(await $.fs.read(`${dataDir}/config.json`));
  } catch {
    return DEFAULT_HOLD_PREFIX;
  }
}

/** Empties the prompt box when it still shows the text that was just held. */
async function clearBoxIfStill($: InterfaceEngine, typed: string): Promise<void> {
  await $.clock.sleep(150);
  const box = await $.prompt.read();
  if (box.text.trim() === typed.trim()) await $.prompt.fill({ text: '' });
}

/** The held messages, in order; none when the list cannot be read. */
async function heldEntries($: InterfaceEngine): Promise<HeldEntry[]> {
  const listed = await cli($, ['list', '--format', 'json']);
  try {
    const value: unknown = JSON.parse(listed.stdout);
    return Array.isArray(value) ? (value as HeldEntry[]) : [];
  } catch {
    return [];
  }
}

/** How many messages are held, read from the queue file (no process started). */
async function heldCount($: InterfaceEngine): Promise<number> {
  try {
    return countHeld(await $.fs.read(`${dataDir}/sessions/${await $.session.id()}/queue.jsonl`));
  } catch {
    return 0;
  }
}

/**
 * Sends held messages: at once when the agent is idle, at the end of its turn
 * while it works. A message leaves the queue only once its prompt was accepted.
 * @param positions As the person sees them; none means all.
 */
async function sendHeld($: InterfaceEngine, positions: readonly string[]): Promise<CommandAnswer> {
  const sent = await cli($, ['send', ...positions]);
  let outcome: { mode?: string; count?: number; text?: string; ids?: string[] } = {};
  try {
    outcome = JSON.parse(sent.stdout) as typeof outcome;
  } catch {
    return display(sent.stdout.trim() || 'cmc could not send the messages.');
  }
  if (outcome.mode === 'now' && typeof outcome.text === 'string' && Array.isArray(outcome.ids)) {
    // The engine takes a plugin's prompt once the session is idle, and a command
    // still running counts as busy: submit once this command has answered.
    void submitThenTake($, outcome.text, outcome.ids);
    return display(`Sending ${outcome.count ?? 0} held message(s)…`);
  }
  if (outcome.mode === 'end') return display(`The agent is working; ${outcome.count ?? 0} held message(s) will be sent when its turn ends.`);
  return display('Nothing is held.');
}

/**
 * Submits released text as a prompt and takes the messages out of the queue
 * only once it was accepted. A refusal is shown with the engine's reason and
 * leaves them held.
 */
async function submitThenTake($: InterfaceEngine, text: string, ids: readonly string[]): Promise<void> {
  await $.clock.sleep(SUBMIT_DELAY_MS);
  let refusal: string | null = null;
  try {
    const result = await $.prompt.submit({ text });
    if (typeof result === 'object' && result !== null && 'drop' in result && typeof result.drop === 'string') refusal = result.drop;
  } catch (error) {
    refusal = error instanceof Error ? error.message : String(error);
  }
  if (refusal !== null) {
    $.ui.log(`cmc: could not send them (${refusal}); they are still held. /cmc:release sends them as a prompt.`);
    return;
  }
  await cli($, ['take', ...ids]);
}

/** The text shown when the menu cannot open (headless) or is closed. */
function listFallback(entries: readonly HeldEntry[]): CommandAnswer {
  const lines = entries.map((entry, index) => labelFor(index + 1, entry.text));
  return display(`${entries.length} held:\n${lines.join('\n')}\n/send [N] sends · ;;edit N text edits · ;;rm N deletes`);
}

/** /held: pick a message in the engine's own dialog, then what to do with it. */
async function heldMenu($: InterfaceEngine): Promise<CommandAnswer> {
  const entries = await heldEntries($);
  if (entries.length === 0) return display('Nothing is held.');

  let position: number | 'all' | null = 1;
  if (entries.length > 1) {
    const more = entries.length > 3 ? ` (type its number for 4–${entries.length})` : '';
    const answer = await $.ui.ask(`Which held message?${more}`, { options: pickOptions(entries), header: 'cmc' }).catch(() => null);
    if (answer === null) return listFallback(entries);
    position = readPick(answer, entries);
  }
  if (position === 'all') return sendHeld($, []);
  if (position === null) return display('No such message: nothing changed.');

  const entry = entries[position - 1];
  if (entry === undefined) return display('No such message: nothing changed.');
  const question = `Message ${position}: «${labelFor(position, entry.text).replace(/^\d+ · /, '')}». What now? (or type new text under Other to replace it)`;
  const action = await $.ui.ask(question, { options: ACTIONS, header: `Message ${position}` }).catch(() => null);
  if (action === null) return listFallback(entries);

  const at = String(position);
  if (action === 'Send') return sendHeld($, [at]);
  if (action === 'Delete') {
    await cli($, ['rm', at]);
    return display(`Deleted: «${labelFor(position, entry.text).replace(/^\d+ · /, '')}».`);
  }
  if (action === 'Hand to an agent') {
    const started = await cli($, ['dispatch', '--message', at]);
    return display(started.stdout.trim());
  }
  if (action === 'Edit') {
    // The text goes back to the box as a control word: change it and press Enter.
    await $.prompt.fill({ text: `${await prefix($)}edit ${at} ${entry.text}` });
    return display('Change the text in the prompt box and press Enter to keep it in its place.');
  }
  // Text typed under "Other" replaces the message.
  const edited = await cli($, ['edit', at], undefined, action);
  return display(edited.stdout.trim());
}

/** The interface's hooks on prompts and commands (the session start is the module's). */
export const register = (on: InterfaceOn): void => {
  on('prompt.submit', async ($, e, next) => {
    // Slash commands and prompts the person did not type pass untouched.
    if (e.command !== undefined || e.isMeta === true || dataDir === undefined) return next(e);
    const text = messageToHold(e.text, await prefix($));
    if (text === null) return next(e);

    const held = await cli($, ['hold', '--stdin'], text).catch(() => null);
    // Not held here: the command hooks beneath hold it the old way.
    if (held === null || held.exitCode !== 0) return next(e);

    // If the box still shows what was just held, empty it.
    void clearBoxIfStill($, e.text).catch(() => undefined);
    return { drop: noticeFor(held.stdout) };
  });

  on('command.run', async ($, e, next) => {
    if (e.command !== 'held' && e.command !== 'send') return next(e);
    if (dataDir === undefined) return display('cmc is not ready yet: try again in a moment.');
    if (e.command === 'held') return heldMenu($);
    const positions = positionsFrom(e.args);
    if (positions === null) return display('Usage: /send, or /send 2 3 for some of the held messages.');
    return sendHeld($, positions);
  });

  on('turn.complete', async ($, e, next) => {
    const result = await next(e);
    if (dataDir === undefined) return result;
    // Esc ends a turn without the Stop hook: tell the core the agent is idle.
    if (e.reason === 'aborted') await cli($, ['idle']).catch(() => undefined);
    const reminder = reminderFor(await heldCount($));
    if (reminder !== null) $.ui.log(reminder);
    return result;
  });
};
