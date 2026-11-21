#!/usr/bin/env node
// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Command line over the same core the hooks use.
import { parseControl, runControl } from '../lib/control.mjs';
import { CmcError } from '../lib/errors.mjs';
import { describeError, logEvent } from '../lib/log.mjs';
import { resolveDataDir, sessionDir } from '../lib/paths.mjs';
import { releaseAll } from '../lib/release.mjs';

const USAGE = `cmc — Claude Message Control (Peterson Sena · r3v3rs3)

Usage: cmc <command> --session <id> [--data-dir <dir>]

  list                 show the held messages, in delivery order
  edit <N> <text>      replace the text of message N
  rm <N> [<N>…]        delete messages
  clear                delete every held message
  move <N> <M>         move message N to position M
  up <N> | down <N>    move message N one place
  top <N> | bottom <N> make message N the first or the last to be delivered
  end                  release everything when the current turn ends
  drain [--format prompt|json]
                       take every held message out of the queue and print it
`;

const VALUE_FLAGS = new Set(['--session', '--data-dir', '--format']);
const QUEUE_COMMANDS = new Set(['list', 'edit', 'rm', 'clear', 'move', 'up', 'down', 'top', 'bottom', 'end']);

/** Splits argv into flags with a value and positional arguments. */
function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (VALUE_FLAGS.has(arg)) {
      if (i + 1 >= argv.length) throw new CmcError('BAD_USAGE', `${arg} needs a value.`);
      flags[arg.slice(2)] = argv[(i += 1)];
    } else if (arg.startsWith('--')) {
      throw new CmcError('BAD_USAGE', `Unknown option ${arg}.`);
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

function requireSession(flags) {
  if (!flags.session) throw new CmcError('BAD_USAGE', 'This command needs --session <id>.');
  return flags.session;
}

function drain({ flags }, dataDir) {
  const format = flags.format ?? 'prompt';
  if (format !== 'prompt' && format !== 'json') throw new CmcError('BAD_USAGE', '--format must be "prompt" or "json".');

  const result = releaseAll(dataDir, requireSession(flags), '/cmc:release');
  if (format === 'json') return JSON.stringify(result);
  const text = result.text ?? '[cmc] The user ran "/cmc:release", but no messages are held. There is nothing to do.';
  return result.warning ? `${text}\n\n[cmc] ${result.warning}` : text;
}

/** The queue commands share their grammar with the control words of the prompt. */
function queueCommand(name, { flags, positional }, dataDir) {
  const control = parseControl([name, ...positional].join(' '));
  if (!control) throw new CmcError('BAD_USAGE', `Wrong arguments for "${name}".\n\n${USAGE}`);
  return runControl(sessionDir(dataDir, requireSession(flags)), control);
}

function main(argv) {
  const [name, ...rest] = argv;
  if (!name || name === 'help' || name === '--help') return USAGE;
  const parsed = parseArgs(rest);
  if (name === 'drain') return drain(parsed, resolveDataDir(parsed.flags['data-dir']));
  if (QUEUE_COMMANDS.has(name)) return queueCommand(name, parsed, resolveDataDir(parsed.flags['data-dir']));
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
