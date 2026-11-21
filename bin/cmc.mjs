#!/usr/bin/env node
// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Command line over the same core the hooks use.
//
//   cmc drain --session <id> [--data-dir <dir>] [--format prompt|json]
import { CmcError } from '../lib/errors.mjs';
import { describeError, logEvent } from '../lib/log.mjs';
import { resolveDataDir } from '../lib/paths.mjs';
import { releaseAll } from '../lib/release.mjs';

const USAGE = `cmc — Claude Message Control (Peterson Sena · r3v3rs3)

Usage:
  cmc drain --session <id> [--data-dir <dir>] [--format prompt|json]
      Take every held message out of the queue and print it.
`;

const VALUE_FLAGS = new Set(['--session', '--data-dir', '--format']);

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

function drain({ flags }, dataDir) {
  const format = flags.format ?? 'prompt';
  if (format !== 'prompt' && format !== 'json') throw new CmcError('BAD_USAGE', '--format must be "prompt" or "json".');
  if (!flags.session) throw new CmcError('BAD_USAGE', 'drain needs --session <id>.');

  const result = releaseAll(dataDir, flags.session, '/cmc:release');
  if (format === 'json') return JSON.stringify(result);
  const text = result.text ?? '[cmc] The user ran "/cmc:release", but no messages are held. There is nothing to do.';
  return result.warning ? `${text}\n\n[cmc] ${result.warning}` : text;
}

const COMMANDS = { drain };

function main(argv) {
  const [name, ...rest] = argv;
  if (!name || name === 'help' || name === '--help') return USAGE;
  const command = COMMANDS[name];
  if (!command) throw new CmcError('BAD_USAGE', `Unknown command "${name}".\n\n${USAGE}`);
  const parsed = parseArgs(rest);
  return command(parsed, resolveDataDir(parsed.flags['data-dir']));
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
