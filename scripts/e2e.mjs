// cmc — end-to-end check against a real Claude Code session. Author: Peterson Sena (r3v3rs3).
//
// Starts `claude -p` with this checkout loaded as a plugin, gives it a slow
// three-step task and types messages into the session while it works. Prints a
// timeline of what the session saw. It spends tokens, so it is not part of
// `npm test`.
//
//   node scripts/e2e.mjs [--mid <text>]... [--cli <args>] [--after <text>]... [--model <name>] [--keep]
//
//   --mid    typed two seconds into the first tool call (repeatable)
//   --cli    cmc CLI arguments, run in the session's folder as from a second terminal when the
//            second tool call starts (for example: --cli "hold also say hello")
//   --after  typed once the turn has ended, one per following turn (repeatable)
//   --keep   keep the scratch working directory
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

const args = process.argv.slice(2);
const options = { mid: [], after: [], cli: null, model: 'haiku', keep: false };
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--mid') options.mid.push(args[(i += 1)]);
  else if (args[i] === '--after') options.after.push(args[(i += 1)]);
  else if (args[i] === '--cli') options.cli = args[(i += 1)];
  else if (args[i] === '--model') options.model = args[(i += 1)];
  else if (args[i] === '--keep') options.keep = true;
  else {
    process.stderr.write(`unknown argument: ${args[i]}\n`);
    process.exit(2);
  }
}

const pluginDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const workDir = mkdtempSync(join(tmpdir(), 'cmc-e2e-'));
const started = Date.now();
const stamp = () => `${((Date.now() - started) / 1000).toFixed(1).padStart(5)}s`;
const print = (label, text = '') => process.stdout.write(`${stamp()}  ${label.padEnd(10)} ${text}\n`);
const oneLine = (text, max = 300) => String(text).replace(/\s+/g, ' ').slice(0, max);

const child = spawn(
  'claude',
  [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--replay-user-messages',
    '--model', options.model,
    '--allowedTools', 'Bash',
    // Only this plugin: the user's own hooks and plugins stay out of the measurement.
    '--setting-sources', 'project',
    '--plugin-dir', pluginDir,
  ],
  { cwd: workDir, stdio: ['pipe', 'pipe', 'inherit'] },
);

function type(text) {
  print('TYPED', text);
  child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`);
}

let sessionId;
let midSent = false;
let toolCalls = 0;
// With --plugin-dir, Claude Code names the data directory "<plugin>-inline".
const dataDir = join(homedir(), '.claude', 'plugins', 'data', 'cmc-inline');

function runCli() {
  // Like a second terminal opened in the same folder: no session id, no data directory.
  const result = spawnSync(process.execPath, [join(pluginDir, 'bin', 'cmc.mjs'), ...options.cli.split(' ')], {
    cwd: workDir,
    encoding: 'utf8',
  });
  print('CLI', `cmc ${options.cli} → ${oneLine(result.stdout)}`);
}
let buffer = '';
const after = [...options.after];

function onMessage(message) {
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
        if (toolCalls === 2 && options.cli) runCli();
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

child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line === '') continue;
    try {
      onMessage(JSON.parse(line));
    } catch (error) {
      print('UNPARSED', oneLine(`${error.message}: ${line}`, 120));
    }
  }
});

const timer = setTimeout(() => {
  print('TIMEOUT');
  child.kill();
}, TIMEOUT_MS);

child.on('exit', (code) => {
  clearTimeout(timer);
  const queue = join(dataDir, 'sessions', String(sessionId), 'queue.jsonl');
  const left = existsSync(queue)
    ? readFileSync(queue, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line).text)
    : [];
  print('QUEUE', `${left.length} held after the session: ${JSON.stringify(left)}`);
  print('SESSION', `${sessionId} in ${workDir}${options.keep ? ' (kept)' : ''}`);
  print('EXIT', String(code));
  if (!options.keep) rmSync(workDir, { recursive: true, force: true });
  process.exit(code ?? 0);
});

type(TASK);
