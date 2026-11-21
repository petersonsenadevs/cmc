// cmc spike drain — throwaway. Author: Peterson Sena (r3v3rs3).
// Prints the held messages and empties the queue. Called from /cmc-spike:release.
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = process.env.CMC_SPIKE_DIR || join(tmpdir(), 'cmc-spike');
mkdirSync(dir, { recursive: true });
const queueFile = join(dir, 'queue.txt');

const lines = existsSync(queueFile)
  ? readFileSync(queueFile, 'utf8').split('\n').filter((line) => line.trim() !== '')
  : [];
if (lines.length > 0) rmSync(queueFile);

appendFileSync(
  join(dir, 'probe.log'),
  `${JSON.stringify({
    t: new Date().toISOString(),
    event: 'drain',
    argv: process.argv.slice(2),
    count: lines.length,
    env: {
      data: process.env.CLAUDE_PLUGIN_DATA ?? null,
      root: process.env.CLAUDE_PLUGIN_ROOT ?? null,
    },
  })}\n`,
);

process.stdout.write(
  lines.length > 0 ? lines.map((line, i) => `${i + 1}. ${line}`).join('\n') : '(no held messages)',
);
