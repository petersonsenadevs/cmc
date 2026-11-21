// cmc — test helper: stands in for the `claude` executable. Author: Peterson Sena (r3v3rs3).
// Reads its input as Claude Code's stream-json (one user message per line),
// answers each message, and exits when its input closes, as the real one does.
// Records how it was called and behaves as FAKE_CLAUDE says (for the first message):
//   ok (default)  prints a stream-json result
//   fail          prints to stderr and exits 3
//   error-result  prints a result marked as an error
//   slow          does not answer (to be cancelled)
//   edit          changes notes.txt in its working folder, then answers like ok
//   commit        like edit, and commits the change
//   stop-hook     answers, then a Stop hook of the user makes it go on with something else
// Every later message gets "Reply to: <message>", with a step before it.
// Given `--worktree <name>` it creates that git worktree, as Claude Code does
// (.claude/worktrees/<name> on the branch worktree-<name>), and works inside it.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

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

const received: string[] = [];
function record(): void {
  if (process.env.FAKE_CLAUDE_RECORD) {
    writeFileSync(process.env.FAKE_CLAUDE_RECORD, JSON.stringify({ argv: process.argv.slice(2), stdin: received.join('\n'), cwd: process.cwd() }));
  }
}

/** Answers the task, the first message, as FAKE_CLAUDE says. */
function answerTask(): void {
  if (behaviour === 'fail') {
    process.stderr.write('fake claude: something broke\n');
    process.exit(3);
  } else if (behaviour === 'slow') {
    setTimeout(() => {}, 60000);
  } else if (behaviour === 'stop-hook') {
    // The answer, then a Stop hook of the user's own setup makes the agent go on.
    line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'The answer to the task.' }] } });
    line({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Stop hook feedback:\nSave your notes before you go.' }] } });
    line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Nothing to save.' }] } });
    line({ type: 'result', is_error: false, result: 'Nothing to save.', session_id: 'fake-session', total_cost_usd: 0.002 });
  } else {
    line({
      type: 'result',
      is_error: behaviour === 'error-result',
      result: behaviour === 'error-result' ? 'I could not do it.' : 'Summary: changed notes.txt.',
      session_id: 'fake-session',
      total_cost_usd: 0.001,
    });
  }
}

/** Answers a later message of the user. */
function answerMessage(text: string): void {
  line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'notes.txt' } }] } });
  line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: `Reply to: ${text}` }] } });
  line({ type: 'result', is_error: false, result: `Reply to: ${text}`, session_id: 'fake-session', total_cost_usd: 0.003 });
}

line({ type: 'system', subtype: 'init', session_id: 'fake-session' });
createInterface({ input: process.stdin })
  .on('line', (raw) => {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    const content = (message as { message?: { content?: unknown } }).message?.content;
    const text = typeof content === 'string' ? content : '';
    received.push(text);
    record();
    if (received.length === 1) answerTask();
    else answerMessage(text);
  })
  .on('close', () => {
    record();
    if (behaviour !== 'slow') process.exit(0);
  });
