#!/usr/bin/env node
// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Command line over the same core the hooks use. Run it from another terminal,
// in the folder where the Claude Code session was started.
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { parseAgentControl, parseDispatch, runAgentControl, startAgent, type DispatchOrigin } from '../lib/agent-control.ts';
import { CONFIG_FILE, loadConfig, writeDefaultConfig, type LoadedConfig } from '../lib/config.ts';
import { parseControl, runControl } from '../lib/control.ts';
import { CmcError, errorCode } from '../lib/errors.ts';
import { describeError, logEvent } from '../lib/log.ts';
import { resolveDataDir, sessionDir } from '../lib/paths.ts';
import { addMessage } from '../lib/queue.ts';
import { armAtEnd, release, select, sendMessages, takeMessages } from '../lib/release.ts';
import { candidateDataDirs, formatSessions, listSessions, openSessionsIn, resolveSession } from '../lib/sessions.ts';

const USAGE = `cmc — Claude Message Control (Peterson Sena · r3v3rs3)

Usage: cmc <command> [--session <id>] [--data-dir <dir>]

The session is the one started in the current folder; name it with --session
(an id or the start of one) when there are several.

  hold <text>          hold a message for the agent, as ";; text" does in the session
  list                 show the held messages, in delivery order
  edit <N> <text>      replace the text of message N
  rm <N> [<N>…]        delete messages
  clear                delete every held message
  move <N> <M>         move message N to position M
  up <N> | down <N>    move message N one place
  top <N> | bottom <N> make message N the first or the last to be delivered
  release [<N>…]       hand messages (all, or those) to the agent when its turn ends
  send [<N>…]          for the plugin's /send: when the agent is idle, prints (JSON) the text
                       to submit and the ids, and takes nothing out; while it works, arms
                       the end of the turn like release
  take <id>…           take messages out of the queue by id (after /send's prompt was accepted)
  dispatch [--pack|--fork] [--auto|--held] <task>
                       start a second agent on a task, as ">> task" does in the session
                       (--pack: it gets a short summary instead of the whole conversation;
                       --auto: its result goes to the session by itself when a turn ends;
                       --fork and --held override settings that make the others the default)
  agents               show the agents dispatched from the session
  log <id>             show what an agent was asked and its latest steps or final answer
  cancel <id>          stop an agent
  sessions [--all]     show the open sessions started in this folder (--all: every session)
  config [init]        show the settings in force and where the file is (init: write a file
                       with every setting at its default, to edit)
  drain [--format prompt|json]
                       take every held message out of the queue and print it
`;

type ValueFlag = 'session' | 'data-dir' | 'format';
type BooleanFlag = 'all' | 'pack' | 'fork' | 'auto' | 'held' | 'stdin';
type Flags = Partial<Record<ValueFlag, string> & Record<BooleanFlag, boolean>>;

interface ParsedArgs {
  flags: Flags;
  positional: string[];
}

// The option as typed, and the name its value is kept under.
const VALUE_FLAGS: ReadonlyMap<string, ValueFlag> = new Map([
  ['--session', 'session'],
  ['--data-dir', 'data-dir'],
  ['--format', 'format'],
]);
const BOOLEAN_FLAGS: ReadonlyMap<string, BooleanFlag> = new Map([
  ['--all', 'all'],
  ['--pack', 'pack'],
  ['--fork', 'fork'],
  ['--auto', 'auto'],
  ['--held', 'held'],
  ['--stdin', 'stdin'],
]);
const QUEUE_COMMANDS: ReadonlySet<string> = new Set(['list', 'edit', 'rm', 'clear', 'move', 'up', 'down', 'top', 'bottom']);
const POSITION = /^[1-9]\d{0,5}$/;

/** Splits argv into flags and positional arguments. */
function parseArgs(argv: readonly string[]): ParsedArgs {
  const flags: Flags = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    const valueFlag = VALUE_FLAGS.get(arg);
    const booleanFlag = BOOLEAN_FLAGS.get(arg);
    if (valueFlag) {
      const value = argv[(i += 1)];
      if (value === undefined) throw new CmcError('BAD_USAGE', `${arg} needs a value.`);
      flags[valueFlag] = value;
    } else if (booleanFlag) {
      flags[booleanFlag] = true;
    } else if (arg.startsWith('--')) {
      throw new CmcError('BAD_USAGE', `Unknown option ${arg}.`);
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

/**
 * Finds the folder of the session a command is meant for.
 *
 * The plugin's own commands pass both the data directory and the full session
 * id, and that pair is used as given. From a terminal, the session is looked
 * up in the registry by folder or by the id the user typed.
 */
function targetDir(flags: Flags): string {
  const dataDirs = candidateDataDirs(flags['data-dir']);
  try {
    return resolveSession({ dataDirs, cwd: process.cwd(), wanted: flags.session }).dir;
  } catch (error) {
    if (errorCode(error) === 'NO_SESSION' && flags.session && flags['data-dir']) {
      return sessionDir(resolveDataDir(flags['data-dir']), flags.session);
    }
    throw error;
  }
}

function hold({ flags, positional }: ParsedArgs): string {
  // --stdin: the text comes on standard input (the plugin's interface sends it
  // so; no length limit of the command line, nothing to quote).
  const text = flags.stdin ? readFileSync(0, 'utf8') : positional.join(' ');
  const { messages, warning } = addMessage(targetDir(flags), { text });
  const receipt = `Held (${messages.length} queued).`;
  return warning ? `${receipt}\n${warning}` : receipt;
}

function sendCommand({ flags, positional }: ParsedArgs): string {
  if (!positional.every((word) => POSITION.test(word))) throw new CmcError('BAD_USAGE', `Wrong arguments for "send".\n\n${USAGE}`);
  return JSON.stringify(sendMessages(targetDir(flags), positional.map(Number)));
}

const MESSAGE_ID = /^[0-9a-f]{8}$/;

function take({ flags, positional }: ParsedArgs): string {
  if (positional.length === 0 || !positional.every((word) => MESSAGE_ID.test(word))) {
    throw new CmcError('BAD_USAGE', `"take" needs message ids.\n\n${USAGE}`);
  }
  return `Took ${takeMessages(targetDir(flags), positional)} message(s).`;
}

function drain({ flags }: ParsedArgs): string {
  const format = flags.format ?? 'prompt';
  if (format !== 'prompt' && format !== 'json') throw new CmcError('BAD_USAGE', '--format must be "prompt" or "json".');

  const result = release(targetDir(flags), 'all', '/cmc:release');
  if (format === 'json') return JSON.stringify(result);
  const text = result.text ?? '[cmc] The user ran "/cmc:release", but no messages are held. There is nothing to do.';
  return result.warning ? `${text}\n\n[cmc] ${result.warning}` : text;
}

/**
 * Arms a release from outside the session. The CLI cannot talk to the agent,
 * so it leaves a note that the plugin's hooks act on.
 */
function releaseCommand({ flags, positional }: ParsedArgs): string {
  if (!positional.every((word) => POSITION.test(word))) {
    throw new CmcError('BAD_USAGE', `Wrong arguments for "release".\n\n${USAGE}`);
  }
  const dir = targetDir(flags);
  const { selection, count, held } = select(dir, positional.map(Number));
  if (held === 0) return 'Nothing is held, so there is nothing to release.';
  armAtEnd(dir, selection);
  return `${count} held message(s) will be released when the agent's turn ends.`;
}

/**
 * The session a dispatch starts from, found as `targetDir` finds it. The
 * transcript comes from the session registry, since no hook is there to say.
 */
/** The settings of the data directory a session folder belongs to (<data>/sessions/<id>). */
function settingsOf(sessionFolder: string): LoadedConfig {
  return loadConfig(dirname(dirname(sessionFolder)));
}

function originFor(flags: Flags): DispatchOrigin {
  const dir = targetDir(flags);
  const { config } = settingsOf(dir);
  const record = listSessions(candidateDataDirs(flags['data-dir'])).find((session) => session.dir === dir);
  const sessionId = basename(dir);
  return {
    dir,
    sessionId,
    cwd: record?.cwd ?? process.cwd(),
    ...(record?.transcriptPath === undefined ? {} : { transcriptPath: record.transcriptPath }),
    permissionMode: config.dispatch.permissionMode,
    tools: config.dispatch.tools,
    restrictTools: config.dispatch.restrictTools,
  };
}

function dispatchCommand({ flags, positional }: ParsedArgs): string {
  if (flags.pack && flags.fork) throw new CmcError('BAD_USAGE', 'Use --pack or --fork, not both.');
  if (flags.auto && flags.held) throw new CmcError('BAD_USAGE', 'Use --auto or --held, not both.');
  const origin = originFor(flags);
  const { config } = settingsOf(origin.dir);
  const { task, mode, returnMode } = parseDispatch(positional.join(' '), { mode: config.dispatch.context, returnMode: config.dispatch.return });
  if (task === '') throw new CmcError('BAD_USAGE', 'dispatch needs a task: cmc dispatch [--pack|--fork] [--auto|--held] <task>.');
  const chosenMode = flags.pack ? 'pack' : flags.fork ? 'fork' : mode;
  const chosenReturn = flags.auto ? 'auto' : flags.held ? 'held' : returnMode;
  return startAgent(origin, task, { mode: chosenMode, returnMode: chosenReturn });
}

/** `agents`, `log <id>` and `cancel <id>` share their grammar with the control words. */
function agentCommand(name: string, { flags, positional }: ParsedArgs): string {
  const control = parseAgentControl([name, ...positional].join(' '));
  if (!control) throw new CmcError('BAD_USAGE', `Wrong arguments for "${name}".\n\n${USAGE}`);
  return runAgentControl(originFor(flags), control);
}

/**
 * Shows the settings in force, or writes a file with the defaults. The data
 * directory is found like a session's, but no session needs to be open.
 */
function configCommand({ flags, positional }: ParsedArgs): string {
  const [action, ...extra] = positional;
  if (extra.length > 0 || (action !== undefined && action !== 'init')) throw new CmcError('BAD_USAGE', `Wrong arguments for "config".\n\n${USAGE}`);
  const dataDirs = candidateDataDirs(flags['data-dir']);
  const [dataDir, ...others] = dataDirs;
  if (dataDir === undefined) throw new CmcError('NO_DATA_DIR', 'cmc has no data directory yet: start a Claude Code session with cmc once, or pass --data-dir.');
  if (others.length > 0) throw new CmcError('AMBIGUOUS_DATA_DIR', `cmc found several data directories; pick one with --data-dir:\n${dataDirs.map((dir) => `  ${dir}`).join('\n')}`);
  if (action === 'init') {
    // Never over a file that exists, valid or not: it holds what the user wrote.
    const loaded = loadConfig(dataDir);
    if (existsConfig(loaded.path)) {
      throw new CmcError('CONFIG_EXISTS', `${loaded.path} already exists; edit it, or delete it first to start again from the defaults.`);
    }
    return `Wrote ${writeDefaultConfig(dataDir)} with every setting at its default. Edit it; the changes apply to the next prompt.`;
  }
  const { config, warnings, path } = loadConfig(dataDir);
  const lines = [`Settings file: ${path}${existsConfig(path) ? '' : ' (not created; these are the defaults)'}`, JSON.stringify(config, null, 2)];
  if (warnings.length > 0) lines.push('', `Problems in ${CONFIG_FILE}:`, ...warnings.map((warning) => `- ${warning}`));
  return lines.join('\n');
}

function sessions({ flags }: ParsedArgs): string {
  const records = listSessions(candidateDataDirs(flags['data-dir']));
  if (flags.all) return records.length > 0 ? `Sessions known to cmc:\n${formatSessions(records)}` : 'cmc knows no sessions yet.';
  const here = openSessionsIn(records, process.cwd());
  return here.length > 0
    ? `Open sessions started in this folder:\n${formatSessions(here)}`
    : 'No open session was started in this folder. See "cmc sessions --all".';
}

/** The queue commands share their grammar with the control words of the prompt. */
function queueCommand(name: string, { flags, positional }: ParsedArgs): string {
  const control = parseControl([name, ...positional].join(' '));
  if (!control) throw new CmcError('BAD_USAGE', `Wrong arguments for "${name}".\n\n${USAGE}`);
  const answer = runControl(targetDir(flags), control);
  // No queue command hands text to the agent (that is ";;now", which the CLI does not offer).
  if (!('reply' in answer)) throw new Error(`"${name}" answered with context for the agent, not with a reply`);
  return answer.reply;
}

function existsConfig(path: string): boolean {
  return existsSync(path);
}

function main(argv: readonly string[]): string {
  const [name, ...rest] = argv;
  if (!name || name === 'help' || name === '--help') return USAGE;
  const parsed = parseArgs(rest);
  if (name === 'hold') return hold(parsed);
  if (name === 'send') return sendCommand(parsed);
  if (name === 'take') return take(parsed);
  if (name === 'drain') return drain(parsed);
  if (name === 'release') return releaseCommand(parsed);
  if (name === 'sessions') return sessions(parsed);
  if (name === 'config') return configCommand(parsed);
  if (name === 'dispatch') return dispatchCommand(parsed);
  if (name === 'agents' || name === 'log' || name === 'cancel') return agentCommand(name, parsed);
  if (QUEUE_COMMANDS.has(name)) return queueCommand(name, parsed);
  throw new CmcError('BAD_USAGE', `Unknown command "${name}".\n\n${USAGE}`);
}

try {
  process.stdout.write(`${main(process.argv.slice(2))}\n`);
} catch (error) {
  if (!(error instanceof CmcError)) logEvent(undefined, 'error', 'cmc cli failed', describeError(error));
  // The message also goes to stdout: when a slash command runs this, stdout is
  // what the user and the agent get to read.
  process.stdout.write(`[cmc] ${error instanceof CmcError ? error.message : 'cmc failed unexpectedly; see the log.'}\n`);
  process.exitCode = 1;
}
