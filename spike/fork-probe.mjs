// cmc spike — throwaway. Author: Peterson Sena (r3v3rs3).
// Forks a Claude Code session while it is in the middle of a turn and reports
// what the fork knows, what it costs and whether the origin is disturbed.
//
//   node spike/fork-probe.mjs <scratchDir>
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const scratch = resolve(process.argv[2] ?? '');
if (!process.argv[2]) {
  process.stderr.write('usage: node spike/fork-probe.mjs <scratchDir>\n');
  process.exit(2);
}
const repo = join(scratch, 'repo');
const elsewhere = join(scratch, 'elsewhere');
mkdirSync(repo, { recursive: true });
mkdirSync(elsewhere, { recursive: true });

const started = Date.now();
const stamp = () => `${((Date.now() - started) / 1000).toFixed(1).padStart(5)}s`;
const print = (label, text = '') => process.stdout.write(`${stamp()}  ${label.padEnd(12)} ${text}\n`);
const oneLine = (text, max = 260) => String(text).replace(/\s+/g, ' ').slice(0, max);

// `--output-format json` prints an array of messages; the result is one of them.
function parseResult(text) {
  const parsed = JSON.parse(text);
  const result = Array.isArray(parsed) ? parsed.find((message) => message.type === 'result') : parsed;
  if (!result) throw new Error('no result message');
  return result;
}

const git = (...args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
if (!existsSync(join(repo, '.git'))) {
  git('init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'notes.txt'), 'The project codename is HERON.\n');
  git('add', '.');
  git('-c', 'user.name=spike', '-c', 'user.email=spike@example.invalid', 'commit', '-q', '-m', 'init');
}

const COMMON = ['--model', 'haiku', '--setting-sources', 'project'];
const TASK =
  'First read notes.txt with the Read tool. Then use the Bash tool three separate times, one after another, ' +
  'never in parallel: `sleep 8; echo step1`, then `sleep 8; echo step2`, then `sleep 8; echo step3`. ' +
  'Finally reply with one line: the codename and the three outputs.';
const QUESTION =
  'Do not use any tool. In one line: what is the project codename, what task were you given, ' +
  'and which of its steps do you know have finished?';

const origin = spawn(
  'claude',
  ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--allowedTools', 'Bash,Read', ...COMMON],
  { cwd: repo, stdio: ['pipe', 'pipe', 'inherit'] },
);

/** Runs a fork to completion and returns its JSON result. */
function fork(label, cwd, extra = []) {
  return new Promise((done) => {
    const child = spawn(
      'claude',
      ['-p', QUESTION, '--resume', sessionId, '--fork-session', '--output-format', 'json', ...COMMON, ...extra],
      { cwd, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('exit', (code) => {
      let result;
      try {
        result = parseResult(out);
      } catch {
        result = null;
      }
      if (result) {
        const usage = result.usage ?? {};
        const input = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
        print(label, `exit=${code} session=${result.session_id} sameAsOrigin=${result.session_id === sessionId}`);
        print(label, `inputTokens=${input} cost=$${result.total_cost_usd} answer: ${oneLine(result.result)}`);
      } else {
        print(label, `exit=${code} no JSON. stdout: ${oneLine(out, 160)} stderr: ${oneLine(err, 200)}`);
      }
      done(result);
    });
  });
}

/**
 * Starts a fork the way a hook would have to: from a short-lived process that
 * exits at once, with the fork detached and writing to a file.
 */
function forkDetached() {
  const outFile = join(scratch, 'detached.json');
  const launcher = `
    import { spawn } from 'node:child_process';
    import { openSync } from 'node:fs';
    const out = openSync(${JSON.stringify(outFile)}, 'w');
    const child = spawn('claude', ${JSON.stringify(['-p', QUESTION, '--resume', sessionId, '--fork-session', '--output-format', 'json', ...COMMON])},
      { cwd: ${JSON.stringify(repo)}, detached: true, stdio: ['ignore', out, out], windowsHide: true });
    child.unref();
    process.stdout.write(String(child.pid));
  `;
  const file = join(scratch, 'launcher.mjs');
  writeFileSync(file, launcher);
  const launched = spawnSync(process.execPath, [file], { encoding: 'utf8' });
  print('DETACHED', `launcher exited ${launched.status} after starting pid ${launched.stdout}`);
  return outFile;
}

let sessionId;
let toolCalls = 0;
let buffer = '';
const pending = [];
let detachedFile;

origin.stdout.on('data', (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line === '') continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.type === 'system' && message.subtype === 'init') sessionId = message.session_id;
    if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type === 'text') print('ORIGIN', oneLine(block.text));
        if (block.type !== 'tool_use') continue;
        toolCalls += 1;
        print('ORIGIN-TOOL', `#${toolCalls} ${oneLine(block.input.command ?? block.input.file_path, 60)}`);
        // Tool call 3 is the second sleep: step1 is done, step2 is running and
        // the transcript ends in a tool call with no result yet.
        if (toolCalls === 3) {
          setTimeout(() => {
            print('FORK', `origin ${sessionId} is mid-turn; starting forks`);
            pending.push(fork('FORK-SAME', repo));
            pending.push(fork('FORK-OTHERCWD', elsewhere));
            pending.push(fork('FORK-WORKTREE', repo, ['--worktree', 'cmc-spike-fork']));
            detachedFile = forkDetached();
          }, 2000);
        }
      }
    }
    if (message.type === 'result') {
      print('ORIGIN-END', `turns=${message.num_turns} cost=$${message.total_cost_usd} result: ${oneLine(message.result)}`);
      origin.stdin.end();
    }
  }
});

origin.on('exit', async (code) => {
  print('ORIGIN-EXIT', String(code));
  await Promise.all(pending);
  // Give the detached fork time to finish on its own.
  for (let i = 0; i < 60 && !(existsSync(detachedFile) && /[}]]$/.test(readFileSync(detachedFile, 'utf8').trim())); i += 1) {
    await new Promise((wait) => setTimeout(wait, 1000));
  }
  const detached = existsSync(detachedFile) ? readFileSync(detachedFile, 'utf8') : '';
  try {
    const result = parseResult(detached);
    print('DETACHED', `finished after its launcher exited. session=${result.session_id} answer: ${oneLine(result.result)}`);
  } catch {
    print('DETACHED', `no result. file: ${oneLine(detached, 200)}`);
  }
  print('WORKTREES', oneLine(git('worktree', 'list').stdout));
  print('BRANCHES', oneLine(git('branch', '--list').stdout));

  // Baseline: the same question to a fresh session that gets a short context pack instead of the history.
  const pack =
    'Context from another session: the project codename is HERON (from notes.txt). That session was asked to read ' +
    'notes.txt and run three sleep/echo steps; step1 has finished, step2 is running.\n\n';
  const fresh = spawnSync('claude', ['-p', pack + QUESTION, '--output-format', 'json', ...COMMON], { cwd: repo, encoding: 'utf8' });
  try {
    const result = parseResult(fresh.stdout);
    const usage = result.usage ?? {};
    const input = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
    print('PACK', `inputTokens=${input} cost=$${result.total_cost_usd} answer: ${oneLine(result.result)}`);
  } catch {
    print('PACK', `no JSON: ${oneLine(fresh.stdout + fresh.stderr, 200)}`);
  }
  process.exit(0);
});

setTimeout(() => {
  print('TIMEOUT');
  origin.kill();
}, 280000);

print('START', repo);
origin.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: TASK } })}\n`);
