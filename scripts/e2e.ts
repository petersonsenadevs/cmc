// cmc — end-to-end check against a real Claude Code session. Author: Peterson Sena (r3v3rs3).
//
// Starts `claude -p` with the plugin of this checkout (plugins/cmc) loaded, gives it a slow
// three-step task and types messages into the session while it works. Prints a
// timeline of what the session saw. It spends tokens, so it is not part of
// `npm test`.
//
//   node scripts/e2e.ts [--mid <text>]... [--cli <args>] [--after <text>]... [--model <name>] [--keep]
//                       [--project <dir>] [--installed]
//
//   --mid    typed two seconds into the first tool call (repeatable)
//   --cli    cmc CLI arguments, run in the session's folder as from a second terminal when the
//            second tool call starts (for example: --cli "hold also say hello")
//   --after  typed once the turn has ended, one per following turn (repeatable)
//   --keep   keep the scratch working directory
//   --project   run in this existing folder instead of a scratch one (it is never deleted)
//   --installed use the plugin as installed for that folder (marketplace, project scope)
//               instead of loading this checkout with --plugin-dir
//
// Environment:
//   CLAUDE_BIN         the Claude Code executable to start (default: `claude` from PATH). It is
//                      started without a shell, so on Windows it has to be a real executable
//                      (claude.exe), not the claude.cmd shim that npm installs.
//   CLAUDE_CONFIG_DIR  honoured as Claude Code does, to find the plugin data directory.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TASK =
  'Use the Bash tool three separate times, one call after another, never in parallel: ' +
  'first `sleep 5; echo step1`, then `sleep 5; echo step2`, then `sleep 5; echo step3`. ' +
  'After the third one, reply with one line listing the three outputs.';
const TIMEOUT_MS = 240000;

interface Options {
  mid: string[];
  after: string[];
  cli: string | null;
  model: string;
  keep: boolean;
  project: string | null;
  installed: boolean;
}

/** One block of a message's content in Claude Code's stream-json output. */
type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; input: { command?: string; [key: string]: unknown } }
  | { type: 'tool_result'; content: unknown };

/** The stream-json messages this script reads; any other line is ignored. */
type StreamMessage =
  | { type: 'system'; subtype: 'init'; session_id: string }
  | { type: 'system'; subtype: 'informational'; content: unknown }
  | { type: 'user'; message: { content: string | ContentBlock[] } }
  | { type: 'assistant'; message: { content: ContentBlock[] } }
  | { type: 'result'; num_turns: number };

const args = process.argv.slice(2);
const options: Options = { mid: [], after: [], cli: null, model: 'haiku', keep: false, project: null, installed: false };

/** The value that follows a flag; stops when the flag is the last argument. */
function valueAt(index: number): string {
  const value = args[index];
  if (value === undefined) {
    process.stderr.write(`missing value for ${args[index - 1]}\n`);
    process.exit(2);
  }
  return value;
}

for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--mid') options.mid.push(valueAt((i += 1)));
  else if (args[i] === '--after') options.after.push(valueAt((i += 1)));
  else if (args[i] === '--cli') options.cli = valueAt((i += 1));
  else if (args[i] === '--model') options.model = valueAt((i += 1));
  else if (args[i] === '--keep') options.keep = true;
  else if (args[i] === '--project') options.project = valueAt((i += 1));
  else if (args[i] === '--installed') options.installed = true;
  else {
    process.stderr.write(`unknown argument: ${args[i]}\n`);
    process.exit(2);
  }
}

const pluginDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'plugins', 'cmc');
const workDir = options.project ?? mkdtempSync(join(tmpdir(), 'cmc-e2e-'));
// A folder the caller gave is theirs: it is never deleted.
if (options.project !== null) options.keep = true;
const started = Date.now();
const stamp = () => `${((Date.now() - started) / 1000).toFixed(1).padStart(5)}s`;
const print = (label: string, text = '') => process.stdout.write(`${stamp()}  ${label.padEnd(10)} ${text}\n`);
const oneLine = (text: unknown, max = 300) => String(text).replace(/\s+/g, ' ').slice(0, max);

const claudeBin = process.env.CLAUDE_BIN || 'claude';

/** Stops before anything is typed: Claude Code itself could not be started. */
function cannotStart(error: NodeJS.ErrnoException): never {
  if (!options.keep) rmSync(workDir, { recursive: true, force: true });
  process.stderr.write(
    [
      `e2e: could not start Claude Code as "${claudeBin}" (${error.code ?? error.message}).`,
      'Set the CLAUDE_BIN environment variable to the full path of the Claude Code executable.',
      'It is started without a shell, so on Windows it must be a real executable (claude.exe),',
      'not a .cmd or .bat shim such as the claude.cmd that npm installs.',
      '',
    ].join('\n'),
  );
  process.exit(2);
}

function startClaude(claudeArgs: string[]) {
  try {
    // A missing executable is reported through the 'error' event; a .cmd or .bat on Windows throws here.
    return spawn(claudeBin, claudeArgs, { cwd: workDir, stdio: ['pipe', 'pipe', 'inherit'] }).on('error', cannotStart);
  } catch (error) {
    return cannotStart(error instanceof Error ? error : new Error(String(error)));
  }
}

const child = startClaude([
  '-p',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--verbose',
  '--replay-user-messages',
  '--model', options.model,
  '--allowedTools', 'Bash',
  // Only this plugin: the user's own hooks and plugins stay out of the measurement.
  // An installed plugin is enabled in the project settings, which stay in.
  '--setting-sources', 'project',
  ...(options.installed ? [] : ['--plugin-dir', pluginDir]),
]);
// The task may be written before a failed start is reported; that report is the one that matters.
child.stdin.on('error', () => {});

function type(text: string) {
  print('TYPED', text);
  child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`);
}

let sessionId: string | undefined;
let midSent = false;
let toolCalls = 0;
// With --plugin-dir, Claude Code names the data directory "<plugin>-inline"; installed
// from the marketplace, "<plugin>-<marketplace>".
const dataDir = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'plugins', 'data', options.installed ? 'cmc-r3v3rs3' : 'cmc-inline');

function runCli(cli: string) {
  // Like a second terminal opened in the same folder: no session id, no data directory.
  const result = spawnSync(process.execPath, [join(pluginDir, 'bin', 'cmc.ts'), ...cli.split(' ')], {
    cwd: workDir,
    encoding: 'utf8',
  });
  print('CLI', `cmc ${cli} → ${oneLine(result.stdout)}`);
}
let buffer = '';
const after = [...options.after];

function onMessage(message: StreamMessage) {
  if (message.type === 'system' && message.subtype === 'init') sessionId = message.session_id;
  if (message.type === 'system' && message.subtype === 'informational') print('NOTICE', oneLine(message.content));
  if (message.type === 'user') {
    const content = message.message.content;
    if (typeof content === 'string') print('DELIVERED', oneLine(content));
    else {
      for (const block of content) {
        if (block.type === 'text') print('DELIVERED', oneLine(block.text));
        if (block.type === 'tool_result') print('TOOL-DONE', oneLine(JSON.stringify(block.content), 40));
      }
    }
  }
  if (message.type === 'assistant') {
    for (const block of message.message.content) {
      if (block.type === 'text') print('AGENT', oneLine(block.text));
      if (block.type === 'tool_use') {
        print('TOOL', oneLine(block.input.command ?? JSON.stringify(block.input), 80));
        toolCalls += 1;
        if (toolCalls === 2 && options.cli) runCli(options.cli);
        if (!midSent) {
          midSent = true;
          setTimeout(() => options.mid.forEach(type), 2000);
        }
      }
    }
  }
  if (message.type === 'result') {
    print('TURN-END', `turns=${message.num_turns}`);
    const next = after.shift();
    if (next) type(next);
    else setTimeout(() => child.stdin.end(), 3000);
  }
}

child.stdout.on('data', (chunk: Buffer) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line === '') continue;
    try {
      onMessage(JSON.parse(line) as StreamMessage);
    } catch (error) {
      print('UNPARSED', oneLine(`${error instanceof Error ? error.message : String(error)}: ${line}`, 120));
    }
  }
});

const timer = setTimeout(() => {
  print('TIMEOUT');
  child.kill();
}, TIMEOUT_MS);

child.on('exit', (code: number | null) => {
  clearTimeout(timer);
  const queue = join(dataDir, 'sessions', String(sessionId), 'queue.jsonl');
  const left = existsSync(queue)
    ? readFileSync(queue, 'utf8').split('\n').filter(Boolean).map((line) => (JSON.parse(line) as { text: string }).text)
    : [];
  print('QUEUE', `${left.length} held after the session: ${JSON.stringify(left)}`);
  print('SESSION', `${sessionId} in ${workDir}${options.keep ? ' (kept)' : ''}`);
  print('EXIT', String(code));
  if (!options.keep) rmSync(workDir, { recursive: true, force: true });
  process.exit(code ?? 0);
});

type(TASK);
