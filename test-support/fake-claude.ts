// cmc — test helper: stands in for the `claude` executable. Author: Peterson Sena (r3v3rs3).
// Records how it was called and behaves as FAKE_CLAUDE says:
//   ok (default)  prints a stream-json result and exits 0
//   fail          prints to stderr and exits 3
//   error-result  prints a result marked as an error and exits 0
//   slow          waits for a minute (to be cancelled)
import { readFileSync, writeFileSync } from 'node:fs';

const stdin = readFileSync(0, 'utf8');
if (process.env.FAKE_CLAUDE_RECORD) {
  writeFileSync(process.env.FAKE_CLAUDE_RECORD, JSON.stringify({ argv: process.argv.slice(2), stdin, cwd: process.cwd() }));
}
const line = (message: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(message)}\n`);
const behaviour = process.env.FAKE_CLAUDE ?? 'ok';

line({ type: 'system', subtype: 'init', session_id: 'fake-session' });
if (behaviour === 'fail') {
  process.stderr.write('fake claude: something broke\n');
  process.exit(3);
} else if (behaviour === 'slow') {
  setTimeout(() => {}, 60000);
} else {
  line({
    type: 'result',
    is_error: behaviour === 'error-result',
    result: behaviour === 'error-result' ? 'I could not do it.' : 'Summary: changed notes.txt.',
    session_id: 'fake-session',
    total_cost_usd: 0.001,
  });
}
