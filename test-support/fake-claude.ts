// cmc — test helper: stands in for the `claude` executable. Author: Peterson Sena (r3v3rs3).
// Records how it was called and behaves as FAKE_CLAUDE says:
//   ok (default)  prints a stream-json result and exits 0
//   fail          prints to stderr and exits 3
//   error-result  prints a result marked as an error and exits 0
//   slow          waits for a minute (to be cancelled)
//   edit          changes notes.txt in its working folder, then answers like ok
//   commit        like edit, and commits the change
// Given `--worktree <name>` it creates that git worktree, as Claude Code does
// (.claude/worktrees/<name> on the branch worktree-<name>), and works inside it.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const stdin = readFileSync(0, 'utf8');
if (process.env.FAKE_CLAUDE_RECORD) {
  writeFileSync(process.env.FAKE_CLAUDE_RECORD, JSON.stringify({ argv: process.argv.slice(2), stdin, cwd: process.cwd() }));
}
const line = (message: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(message)}\n`);
const behaviour = process.env.FAKE_CLAUDE ?? 'ok';

const git = (cwd: string, args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });
let folder = process.cwd();
const flag = process.argv.indexOf('--worktree');
const worktree = flag >= 0 ? process.argv[flag + 1] : undefined;
if (worktree !== undefined) {
  folder = join(process.cwd(), '.claude', 'worktrees', worktree);
  git(process.cwd(), ['worktree', 'add', '-q', '-b', `worktree-${worktree}`, folder]);
}
if (behaviour === 'edit' || behaviour === 'commit') {
  writeFileSync(join(folder, 'notes.txt'), 'changed by the agent\n');
  if (behaviour === 'commit') {
    git(folder, ['add', 'notes.txt']);
    git(folder, ['-c', 'user.name=agent', '-c', 'user.email=agent@example.invalid', 'commit', '-q', '-m', 'agent change']);
  }
}

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
