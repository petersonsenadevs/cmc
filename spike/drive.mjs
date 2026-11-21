// cmc spike driver — throwaway. Author: Peterson Sena (r3v3rs3).
// Runs a headless Claude Code session with the spike plugin over stream-json
// and types messages into it while a turn is still running.
//
//   node spike/drive.mjs <scenario> <workDir> <spikeDataDir>
//
// Scenarios: hold | slash | plain | stop | post | now
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [scenario = 'hold', workDir, dataDir] = process.argv.slice(2);
if (!workDir || !dataDir) {
  process.stderr.write('usage: node spike/drive.mjs <scenario> <workDir> <spikeDataDir>\n');
  process.exit(2);
}

const pluginDir = dirname(fileURLToPath(import.meta.url));
mkdirSync(workDir, { recursive: true });
mkdirSync(dataDir, { recursive: true });
const outFile = join(dataDir, `stream-${scenario}.jsonl`);
writeFileSync(outFile, '');

const LONG_TASK =
  'Use the Bash tool three separate times, one call after another, never in parallel: ' +
  'first `sleep 5; echo step1`, then `sleep 5; echo step2`, then `sleep 5; echo step3`. ' +
  'After the third one, reply with one line listing the outputs, and quote verbatim any other ' +
  'user message or extra context you received during this task (or say NONE).';

// What to type once the first tool call is under way, and what to send after the turn ends.
const scenarios = {
  hold: { midTurn: [';; HELD-ALPHA please also say pineapple'], afterTurn: ['/cmc-spike:release'] },
  slash: { seedQueue: 'SEEDED-BRAVO say mango', midTurn: ['/cmc-spike:release'], afterTurn: [] },
  plain: { midTurn: ['PLAIN-CHARLIE: also say coconut at the end'], afterTurn: [] },
  stop: { stopBlock: 'STOP-DELTA: before you finish, also reply with the word papaya.', midTurn: [], afterTurn: [] },
  now: { seedQueue: 'SEEDED-FOXTROT say the word lychee', midTurn: [';;now'], afterTurn: [] },
  post: { postContext: 'POST-ECHO: a held user message was released: say the word guava.', midTurn: [], afterTurn: [] },
};
const plan = scenarios[scenario];
if (!plan) {
  process.stderr.write(`unknown scenario ${scenario}\n`);
  process.exit(2);
}
if (plan.seedQueue) writeFileSync(join(dataDir, 'queue.txt'), `${plan.seedQueue}\n`);
if (plan.stopBlock) writeFileSync(join(dataDir, 'stop-block.txt'), plan.stopBlock);
if (plan.postContext) writeFileSync(join(dataDir, 'post-context.txt'), plan.postContext);

const child = spawn(
  'claude',
  [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--replay-user-messages',
    '--model', 'haiku',
    '--allowedTools', 'Bash',
    '--setting-sources', 'project',
    '--plugin-dir', pluginDir,
  ],
  {
    cwd: resolve(workDir),
    env: { ...process.env, CMC_SPIKE_DIR: resolve(dataDir) },
    shell: process.platform === 'win32',
    stdio: ['pipe', 'pipe', 'inherit'],
  },
);

const mark = (note) =>
  appendFileSync(join(dataDir, 'probe.log'), `${JSON.stringify({ t: new Date().toISOString(), event: 'driver', note })}\n`);

function send(text) {
  mark(`send: ${text}`);
  child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`);
}

let midTurnSent = false;
let results = 0;
const afterTurn = [...plan.afterTurn];
let buffer = '';

child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line === '') continue;
    appendFileSync(outFile, `${line}\n`);
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    const usesTool =
      message.type === 'assistant' && message.message?.content?.some((block) => block.type === 'tool_use');
    if (usesTool && !midTurnSent) {
      midTurnSent = true;
      // Two seconds into the first five-second sleep: the turn is clearly busy.
      setTimeout(() => plan.midTurn.forEach(send), 2000);
    }
    if (message.type === 'result') {
      results += 1;
      mark(`result ${results}: ${String(message.result).slice(0, 300)}`);
      const next = afterTurn.shift();
      if (next) send(next);
      else setTimeout(() => child.stdin.end(), 4000);
    }
  }
});

child.on('exit', (code) => {
  mark(`exit ${code}`);
  process.exit(code ?? 0);
});

mark(`scenario ${scenario}`);
send(LONG_TASK);
setTimeout(() => {
  mark('timeout');
  child.kill();
}, 240000);
