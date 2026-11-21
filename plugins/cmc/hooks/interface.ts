// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// The interactive interface, inside Claude Code's plugin engine:
//  - a prompt that starts with the hold prefix and a space is held the moment
//    Enter is pressed, and leaves the prompt box with a short notice;
//  - /held and /send are the plugin's own commands: they run at once, even
//    while the agent works, and the agent never sees them.
//
// This file runs in the engine, not in Node: no `node:` imports. Everything that
// touches the queue goes through the cmc command line (`bin/cmc.ts`), so the
// lock, the atomic writes and the rules of the core are the same as everywhere.
// If anything here fails, the prompt goes on to the command hooks beneath,
// which hold it the old way: a message is never lost because of this layer.

const DEFAULT_HOLD_PREFIX = ';;';

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
};

export const COMMANDS = Object.freeze([
  { name: 'held', description: 'cmc: show the messages you are holding (the agent does not see this)', immediate: true },
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

/** The plugin data folder, known once the session has started. */
let dataDir: string | undefined;

/** Starts the interface for a session: called once, from the session start of the module. */
export async function startInterface($: InterfaceEngine): Promise<void> {
  ({ CLAUDE_PLUGIN_DATA: dataDir } = await $.process.hookEnv());
  for (const spec of COMMANDS) await $.command.register(spec);
}

/** Runs the cmc command line for this session; `stdin` is written to its standard input. */
async function cli($: InterfaceEngine, args: readonly string[], stdin?: string): Promise<RunResult> {
  const sessionId = await $.session.id();
  const argv = ['node', `${$.plugin.root}/bin/cmc.ts`, ...args, '--data-dir', dataDir ?? '', '--session', sessionId];
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
    const count = held.stdout.match(/Held \((\d+) queued\)/)?.[1] ?? '?';
    return { drop: `cmc: held (${count}). /held shows them, /send sends them.` };
  });

  on('command.run', async ($, e, next) => {
    if (e.command !== 'held' && e.command !== 'send') return next(e);
    if (dataDir === undefined) return display('cmc is not ready yet: try again in a moment.');

    if (e.command === 'held') {
      const listed = await cli($, ['list']);
      return display(listed.stdout.trim() || listed.stderr.trim());
    }

    const positions = positionsFrom(e.args);
    if (positions === null) return display('Usage: /send, or /send 2 3 for some of the held messages.');
    const sent = await cli($, ['send', ...positions]);
    let outcome: { mode?: string; count?: number; text?: string; ids?: string[] } = {};
    try {
      outcome = JSON.parse(sent.stdout) as typeof outcome;
    } catch {
      return display(sent.stdout.trim() || 'cmc could not send the messages.');
    }
    if (outcome.mode === 'now' && typeof outcome.text === 'string' && Array.isArray(outcome.ids)) {
      // The messages leave the queue only once the prompt was accepted.
      const accepted = await $.prompt.submit({ text: outcome.text }).then(
        (result) => !(typeof result === 'object' && result !== null && 'drop' in result && typeof result.drop === 'string'),
        () => false,
      );
      if (!accepted) return display('Could not send them now; they are still held. /cmc:release sends them as a prompt.');
      await cli($, ['take', ...outcome.ids]);
      return display(`${outcome.count ?? 0} held message(s) sent.`);
    }
    if (outcome.mode === 'end') return display(`The agent is working; ${outcome.count ?? 0} held message(s) will be sent when its turn ends.`);
    return display('Nothing is held.');
  });
};
