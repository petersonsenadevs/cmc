#!/usr/bin/env node
// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Command line over the same core the hooks use. Run it from another terminal,
// in the folder where the Claude Code session was started.
import { parseControl, runControl } from '../lib/control.mjs';
import { CmcError } from '../lib/errors.mjs';
import { describeError, logEvent } from '../lib/log.mjs';
import { resolveDataDir, sessionDir } from '../lib/paths.mjs';
import { addMessage } from '../lib/queue.mjs';
import { arm, release, select } from '../lib/release.mjs';
import { candidateDataDirs, formatSessions, listSessions, openSessionsIn, resolveSession } from '../lib/sessions.mjs';

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
  release [<N>…] [--now|--end]
                       hand messages to the agent from outside the session: at its next
                       step (--now, the default) or when its turn ends (--end)
  sessions [--all]     show the open sessions started in this folder (--all: every session)
  drain [--format prompt|json]
                       take every held message out of the queue and print it
`;

const VALUE_FLAGS = new Set(['--session', '--data-dir', '--format']);
const BOOLEAN_FLAGS = new Set(['--now', '--end', '--all']);
const QUEUE_COMMANDS = new Set(['list', 'edit', 'rm', 'clear', 'move', 'up', 'down', 'top', 'bottom']);
const POSITION = /^[1-9]\d{0,5}$/;

/** Splits argv into flags and positional arguments. */
function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (VALUE_FLAGS.has(arg)) {
      if (i + 1 >= argv.length) throw new CmcError('BAD_USAGE', `${arg} needs a value.`);
      flags[arg.slice(2)] = argv[(i += 1)];
    } else if (BOOLEAN_FLAGS.has(arg)) {
      flags[arg.slice(2)] = true;
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
function targetDir(flags) {
  const dataDirs = candidateDataDirs(flags['data-dir']);
  try {
    return resolveSession({ dataDirs, cwd: process.cwd(), wanted: flags.session }).dir;
  } catch (error) {
    const direct = error.code === 'NO_SESSION' && flags.session && flags['data-dir'];
    if (direct) return sessionDir(resolveDataDir(flags['data-dir']), flags.session);
    throw error;
  }
}

function hold({ flags, positional }) {
  const { messages, warning } = addMessage(targetDir(flags), { text: positional.join(' ') });
  const receipt = `Held (${messages.length} queued).`;
  return warning ? `${receipt}\n${warning}` : receipt;
}

function drain({ flags }) {
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
function releaseCommand({ flags, positional }) {
  if (flags.now && flags.end) throw new CmcError('BAD_USAGE', 'Use --now or --end, not both.');
  if (!positional.every((word) => POSITION.test(word))) {
    throw new CmcError('BAD_USAGE', `Wrong arguments for "release".\n\n${USAGE}`);
  }
  const dir = targetDir(flags);
  const { selection, count, held } = select(dir, positional.map(Number));
  if (held === 0) return 'Nothing is held, so there is nothing to release.';
  arm(dir, flags.end ? 'atEnd' : 'atNextStep', selection);
  return flags.end
    ? `${count} held message(s) will be released when the agent's turn ends.`
    : `${count} held message(s) will be released at the agent's next step, or when its turn ends if it takes none.`;
}

function sessions({ flags }) {
  const records = listSessions(candidateDataDirs(flags['data-dir']));
  if (flags.all) return records.length > 0 ? `Sessions known to cmc:\n${formatSessions(records)}` : 'cmc knows no sessions yet.';
  const here = openSessionsIn(records, process.cwd());
  return here.length > 0
    ? `Open sessions started in this folder:\n${formatSessions(here)}`
    : 'No open session was started in this folder. See "cmc sessions --all".';
}

/** The queue commands share their grammar with the control words of the prompt. */
function queueCommand(name, { flags, positional }) {
  const control = parseControl([name, ...positional].join(' '));
  if (!control) throw new CmcError('BAD_USAGE', `Wrong arguments for "${name}".\n\n${USAGE}`);
  return runControl(targetDir(flags), control).reply;
}

function main(argv) {
  const [name, ...rest] = argv;
  if (!name || name === 'help' || name === '--help') return USAGE;
  const parsed = parseArgs(rest);
  if (name === 'hold') return hold(parsed);
  if (name === 'drain') return drain(parsed);
  if (name === 'release') return releaseCommand(parsed);
  if (name === 'sessions') return sessions(parsed);
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
