// cmc — dispatching a second agent. Author: Peterson Sena (r3v3rs3).
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findAgent, isAlive, listAgents, readAgentAt } from '../plugins/cmc/lib/agents-registry.ts';
import { buildCommand, cancelAgent, DEFAULT_TOOLS, dispatch, forkPrompt } from '../plugins/cmc/lib/dispatch.ts';
import { sessionDir } from '../plugins/cmc/lib/paths.ts';

const fake = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-support', 'fake-claude.ts');
const SESSION = 'd0546eba-c080-415b-b5e2-863787cb5937';

let base;
let dir;
let recordFile;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'cmc-dispatch-'));
  dir = sessionDir(join(base, 'data'), SESSION);
  recordFile = join(base, 'called.json');
});
afterEach(async () => {
  const agents = listAgents(dir);
  for (const agent of agents) {
    if (agent.state === 'running' || agent.state === 'starting') cancelAgent(dir, agent.id);
  }
  // A supervisor records the result a moment before it exits, and Windows will
  // not delete a folder that is still some process's working directory.
  const pids = agents.flatMap((agent) => [agent.runnerPid, agent.pid]);
  for (let i = 0; i < 100 && pids.some(isAlive); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

function start(task, behaviour = 'ok', extra = {}) {
  return dispatch({
    sessionDir: dir,
    sessionId: SESSION,
    task,
    // Not the scratch folder: Windows keeps a process's working directory locked
    // for a while after it exits, and the folder could not be removed.
    cwd: tmpdir(),
    claude: [process.execPath, fake],
    env: { ...process.env, FAKE_CLAUDE: behaviour, FAKE_CLAUDE_RECORD: recordFile },
    ...extra,
  });
}

async function settled(id, wanted = (agent) => agent.state !== 'starting' && agent.state !== 'running') {
  for (let i = 0; i < 200; i += 1) {
    const agent = findAgent(dir, id);
    if (wanted(agent)) return agent;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`agent ${id} did not settle: ${JSON.stringify(findAgent(dir, id))}`);
}

describe('buildCommand', () => {
  const base = { claude: ['claude'], mode: 'fork', sessionId: SESSION, worktree: null, permissionMode: 'acceptEdits', tools: DEFAULT_TOOLS };

  it('forks the session with limited permissions and a tool list', () => {
    assert.deepEqual(buildCommand(base), [
      'claude', '-p', '--output-format', 'stream-json', '--verbose',
      '--permission-mode', 'acceptEdits',
      '--allowedTools', 'Read,Glob,Grep,Edit,Write',
      '--resume', SESSION, '--fork-session',
    ]);
  });

  it('adds the worktree and leaves the session out in pack mode', () => {
    const command = buildCommand({ ...base, mode: 'pack', worktree: 'cmc-1a2b3c4d' });
    assert.deepEqual(command.slice(-2), ['--worktree', 'cmc-1a2b3c4d']);
    assert.equal(command.includes('--resume'), false);
  });

  it('never accepts bypassPermissions, or a tool that is not a plain tool name', () => {
    assert.throws(() => buildCommand({ ...base, permissionMode: 'bypassPermissions' }), { code: 'BAD_PERMISSION_MODE' });
    assert.throws(() => buildCommand({ ...base, permissionMode: 'dontAsk' }), { code: 'BAD_PERMISSION_MODE' });
    assert.throws(() => buildCommand({ ...base, tools: ['Read', '--dangerously-skip-permissions'] }), { code: 'BAD_TOOL' });
    assert.throws(() => buildCommand({ ...base, tools: ['Bash(git:*) --x'] }), { code: 'BAD_TOOL' });
    assert.ok(buildCommand({ ...base, tools: ['Read', 'Bash(npm test:*)'] }).includes('Read,Bash(npm test:*)'));
  });
});

describe('dispatch', () => {
  it('returns at once with a registered agent, then records how it finished', async () => {
    const before = Date.now();
    const agent = start('review the tests of module X');
    assert.ok(Date.now() - before < 2000, 'does not wait for the agent');
    assert.match(agent.id, /^[a-f0-9]{8}$/);
    assert.equal(agent.task, 'review the tests of module X');
    assert.ok(agent.runnerPid > 0);

    const done = await settled(agent.id);
    assert.equal(done.state, 'finished');
    assert.equal(done.exitCode, 0);
    assert.equal(done.summary, 'Summary: changed notes.txt.');
    assert.equal(done.agentSessionId, 'fake-session');
    assert.ok(done.endedAt >= done.startedAt);
    assert.match(readFileSync(join(done.dir, 'output.jsonl'), 'utf8'), /"type":"result"/);
  });

  it('feeds the task through stdin and never puts it on the command line', async () => {
    const task = 'fix it"; rm -rf / #\n$(whoami) `id` && echo INJECTED';
    const agent = start(task);
    await settled(agent.id);
    const called = JSON.parse(readFileSync(recordFile, 'utf8'));
    assert.equal(called.stdin, forkPrompt(task));
    assert.equal(called.argv.join(' ').includes('INJECTED'), false);
    assert.deepEqual(called.argv.slice(0, 3), ['-p', '--output-format', 'stream-json']);
    assert.deepEqual(called.argv.slice(-3), ['--resume', SESSION, '--fork-session']);
    assert.equal(existsSync(join(base, 'INJECTED')), false);
  });

  it('marks the agent failed with what it said when it exits with an error', async () => {
    const failed = await settled(start('will fail', 'fail').id);
    assert.equal(failed.state, 'failed');
    assert.equal(failed.exitCode, 3);
    assert.match(failed.summary, /something broke/);
  });

  it('marks the agent failed when its result is an error, even with exit code 0', async () => {
    const failed = await settled(start('will answer with an error', 'error-result').id);
    assert.equal(failed.state, 'failed');
    assert.equal(failed.summary, 'I could not do it.');
  });

  it('marks the agent failed when the executable cannot be started', async () => {
    const failed = await settled(start('no executable', 'ok', { claude: [join(base, 'no-such-claude')] }).id);
    assert.equal(failed.state, 'failed');
    assert.match(failed.summary, /^The agent could not be started: /);
  });

  it('cancels a running agent and ends its process', async () => {
    const agent = start('takes a minute', 'slow');
    const running = await settled(agent.id, (current) => current.state === 'running' && current.pid > 0);
    const cancelled = cancelAgent(dir, agent.id.slice(0, 4));
    assert.equal(cancelled.state, 'cancelled');
    for (let i = 0; i < 100 && (isAlive(running.pid) || isAlive(running.runnerPid)); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(isAlive(running.pid), false);
    assert.equal(isAlive(running.runnerPid), false);
    assert.equal(readAgentAt(running.dir).state, 'cancelled', 'the supervisor does not overwrite the cancellation');
    assert.throws(() => cancelAgent(dir, agent.id), { code: 'AGENT_NOT_RUNNING' });
  });

  it('rejects an empty or oversized task and unknown agents', () => {
    assert.throws(() => start('   '), { code: 'EMPTY_TASK' });
    assert.throws(() => start('x'.repeat(20001)), { code: 'TASK_TOO_LONG' });
    assert.throws(() => start('ok', 'ok', { permissionMode: 'bypassPermissions' }), { code: 'BAD_PERMISSION_MODE' });
    assert.deepEqual(listAgents(dir), []);
    assert.throws(() => findAgent(dir, 'deadbeef'), { code: 'NO_SUCH_AGENT' });
    assert.throws(() => cancelAgent(dir, '../x'), { code: 'NO_SUCH_AGENT' });
  });

  it('lists agents oldest first and reports one whose process vanished as lost', async () => {
    const first = start('first');
    await settled(first.id);
    const second = start('second', 'slow');
    const running = await settled(second.id, (current) => current.state === 'running' && current.pid > 0);
    assert.deepEqual(listAgents(dir).map((agent) => agent.task), ['first', 'second']);

    // Kill the processes behind the registry's back.
    cancelAgent(dir, second.id);
    for (let i = 0; i < 100 && (isAlive(running.pid) || isAlive(running.runnerPid)); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const { updateAgentAt } = await import('../plugins/cmc/lib/agents-registry.ts');
    updateAgentAt(running.dir, { state: 'running' });
    assert.equal(findAgent(dir, second.id).state, 'lost');
  });
});
