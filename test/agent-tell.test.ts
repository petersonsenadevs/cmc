// cmc — talking to a subagent: its session stays open, the conversation is kept in order, and the user
// writes to it while it works, while it waits, or after it closed. Author: Peterson Sena (r3v3rs3).
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseAgentControl } from '../plugins/cmc/lib/agent-control.ts';
import { describeTool, userLine } from '../plugins/cmc/lib/agent-runner.ts';
import { findAgent, isAlive, listAgents, readConversation, type AgentRecord } from '../plugins/cmc/lib/agents-registry.ts';
import { cancelAgent, dispatch, resumeCommand, tellAgent } from '../plugins/cmc/lib/dispatch.ts';
import { sessionDir } from '../plugins/cmc/lib/paths.ts';
import { listMessages } from '../plugins/cmc/lib/queue.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fake = join(root, 'test-support', 'fake-claude.ts');
const SESSION = '9d4c2b7e-1a3f-4e5d-8c6b-0f2e4a6c8d1b';

let base: string;
let dir: string;
beforeEach(() => {
  base = realpathSync.native(mkdtempSync(join(tmpdir(), 'cmc-tell-')));
  dir = sessionDir(join(base, 'data'), SESSION);
});
afterEach(async () => {
  for (const agent of listAgents(dir)) {
    if (agent.state === 'running' || agent.state === 'waiting' || agent.state === 'starting') {
      try {
        cancelAgent(dir, agent.id);
      } catch {
        // Ended meanwhile.
      }
    }
  }
  const pids = listAgents(dir).flatMap((agent) => [agent.runnerPid, agent.pid]);
  for (let i = 0; i < 100 && pids.some(isAlive); i += 1) await new Promise<void>((resolve) => setTimeout(resolve, 50));
  rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const env = { ...process.env, FAKE_CLAUDE: 'ok' };
function start(keepOpenMs: number): AgentRecord {
  return dispatch({ sessionDir: dir, sessionId: SESSION, task: 'review the notes', cwd: tmpdir(), claude: [process.execPath, fake], env, keepOpenMs, worktree: null });
}
async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (check()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`timed out waiting for ${what}`);
}
const agentNow = (id: string) => findAgent(dir, id);
const roles = (id: string) => readConversation(agentNow(id).dir).map((entry) => `${entry.role}: ${entry.text}`);

describe('a subagent session kept open', () => {
  it('answers, waits for the user, and returns each answer to the queue', async () => {
    const agent = start(30_000);
    await until(() => agentNow(agent.id).state === 'waiting', 'the first answer');
    assert.deepEqual(roles(agent.id), ['you: review the notes', 'agent: Summary: changed notes.txt.']);
    const [first] = listMessages(dir).messages;
    assert.equal(first?.source, `agent ${agent.id}`);
    assert.match(first?.text ?? '', /^Subagent [0-9a-f]{8} answered \(task "review the notes"\):\nSummary: changed notes.txt\./);
    assert.match(first?.text ?? '', /;;tell [0-9a-f]{8} <message>/);
  });

  it('takes a message written to it, answers it, and keeps the conversation in order', async () => {
    const agent = start(30_000);
    await until(() => agentNow(agent.id).state === 'waiting', 'the first answer');
    tellAgent(dir, agent.id, 'now list the open tasks');
    await until(() => (agentNow(agent.id).turns ?? 0) === 2, 'the second answer');
    assert.deepEqual(roles(agent.id), [
      'you: review the notes',
      'agent: Summary: changed notes.txt.',
      'you: now list the open tasks',
      'step: Read notes.txt',
      'agent: Reply to: now list the open tasks',
    ]);
    assert.equal(agentNow(agent.id).state, 'waiting');
    assert.equal(agentNow(agent.id).summary, 'Reply to: now list the open tasks');
    assert.equal(listMessages(dir).messages.length, 2, 'each answer goes back to the session');
  });

  it('closes its session after the keep-open time, and the conversation says so', async () => {
    const agent = start(400);
    await until(() => agentNow(agent.id).state === 'finished', 'the session to close');
    assert.equal(roles(agent.id).at(-1), 'note: Its session closed.');
    assert.equal(listMessages(dir).messages.length, 1, 'closing adds no second report');
  });

  it('can be stopped while it waits', async () => {
    const agent = start(30_000);
    await until(() => agentNow(agent.id).state === 'waiting', 'the first answer');
    assert.equal(cancelAgent(dir, agent.id).state, 'cancelled');
  });
});

describe('writing to a subagent whose session closed', () => {
  it('resumes its own session, without forking, and gets the answer', async () => {
    const agent = start(0);
    await until(() => agentNow(agent.id).state === 'finished', 'the agent to finish');
    assert.equal(agentNow(agent.id).agentSessionId, 'fake-session');
    tellAgent(dir, agent.id, 'one more thing', env);
    const resumed = agentNow(agent.id);
    assert.deepEqual(resumed.command.slice(-2), ['--resume', 'fake-session']);
    assert.ok(!resumed.command.includes('--fork-session'));
    await until(() => readConversation(agentNow(agent.id).dir).some((entry) => entry.text === 'Summary: changed notes.txt.' && entry.role === 'agent'), 'the reply');
    assert.ok(roles(agent.id).includes('you: one more thing'));
  });

  it('refuses an empty message, a cancelled agent and one that never answered', async () => {
    const agent = start(30_000);
    assert.throws(() => tellAgent(dir, agent.id, '   '), { code: 'EMPTY_MESSAGE' });
    await until(() => agentNow(agent.id).state === 'waiting', 'the first answer');
    cancelAgent(dir, agent.id);
    assert.throws(() => tellAgent(dir, agent.id, 'hello'), { code: 'AGENT_CANCELLED' });
  });
});

describe('pieces', () => {
  it('reads ";;tell <id> <message>" with the message as typed', () => {
    assert.deepEqual(parseAgentControl('tell ab12cd34 list the files\nand sort them'), { name: 'tell', id: 'ab12cd34', text: 'list the files\nand sort them' });
    assert.equal(parseAgentControl('tell ab12cd34'), null);
    assert.equal(parseAgentControl('tell nothex12 hi'), null);
  });

  it('builds the resume command from the original one', () => {
    assert.deepEqual(
      resumeCommand(['claude', '-p', '--tools', 'Read', '--resume', 'main-session', '--fork-session', '--worktree', 'cmc-ab12cd34'], 'agent-session'),
      ['claude', '-p', '--tools', 'Read', '--resume', 'agent-session'],
    );
  });

  it('describes tool calls as conversation steps, and words a user message for stream-json', () => {
    assert.equal(describeTool({ name: 'Read', input: { file_path: 'src/a.ts' } }), 'Read src/a.ts');
    assert.equal(describeTool({ name: 'Grep', input: { pattern: 'TODO' } }), 'Grep TODO');
    assert.equal(describeTool({ name: 'Task' }), 'Task');
    assert.equal(userLine('hi'), '{"type":"user","message":{"role":"user","content":"hi"}}\n');
  });
});
