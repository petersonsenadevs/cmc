// cmc — dispatching from the prompt and the control words about agents. Author: Peterson Sena (r3v3rs3).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseAgentControl, parseDispatch } from '../plugins/cmc/lib/agent-control.ts';
import { findAgent, isAlive, listAgents, type AgentRecord } from '../plugins/cmc/lib/agents-registry.ts';
import { formatAgents, formatDuration } from '../plugins/cmc/lib/agents-view.ts';
import { handlePrompt, type PromptBlock, type PromptContext } from '../plugins/cmc/lib/capture.ts';
import { sessionDir } from '../plugins/cmc/lib/paths.ts';
import { addMessage, listMessages } from '../plugins/cmc/lib/queue.ts';
import { handleSessionStart } from '../plugins/cmc/lib/sessions.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fake = join(root, 'test-support', 'fake-claude.ts');
const SESSION = 'd0546eba-c080-415b-b5e2-863787cb5937';

let base: string;
let dataDir: string;
let work: string;
let dir: string;

beforeEach(() => {
  base = realpathSync.native(mkdtempSync(join(tmpdir(), 'cmc-prompt-dispatch-')));
  dataDir = join(base, 'data');
  // A plain folder (no git): agents share it, so no worktree is involved here.
  work = join(base, 'work');
  mkdirSync(work);
  dir = sessionDir(dataDir, SESSION);
});

afterEach(async () => {
  const agents = listAgents(dir);
  for (const agent of agents) {
    if (agent.state === 'running' || agent.state === 'starting') type(`;;cancel ${agent.id}`);
  }
  const pids = agents.flatMap((agent) => [agent.runnerPid, agent.pid]);
  for (let i = 0; i < 100 && pids.some(isAlive); i += 1) await pause(50);
  try {
    rmSync(base, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  } catch (error) {
    // The agents work in the scratch folder, and Windows keeps a folder locked for
    // a while after a process that worked in it exits; elsewhere this is an error.
    if (process.platform !== 'win32') throw error;
  }
});

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function type(prompt: string, behaviour = 'ok'): PromptBlock | PromptContext | null {
  return handlePrompt(
    { session_id: SESSION, prompt, cwd: work, transcript_path: join(root, 'test', 'fixtures', 'transcript.jsonl') },
    { dataDir, claude: [process.execPath, fake], env: { ...process.env, FAKE_CLAUDE: behaviour } },
  );
}

/** The reply of a blocked prompt; fails the test if the prompt was not blocked. */
function reply(output: PromptBlock | PromptContext | null): string {
  assert.ok(output !== null && 'decision' in output, `expected a blocked prompt, got ${JSON.stringify(output)}`);
  return output.reason;
}

const onlyAgent = (): AgentRecord => {
  const [agent, ...others] = listAgents(dir);
  assert.ok(agent !== undefined && others.length === 0, 'exactly one agent');
  return agent;
};

async function ended(id: string): Promise<AgentRecord> {
  for (let i = 0; i < 200; i += 1) {
    const agent = findAgent(dir, id);
    if (agent.state !== 'starting' && agent.state !== 'running') return agent;
    await pause(50);
  }
  throw new Error(`agent ${id} did not end`);
}

describe('parsing', () => {
  it('splits the task from the --pack and --auto flags, in any order', () => {
    assert.deepEqual(parseDispatch(' review the tests '), { task: 'review the tests', mode: 'fork', returnMode: 'held' });
    assert.deepEqual(parseDispatch('--pack review the tests'), { task: 'review the tests', mode: 'pack', returnMode: 'held' });
    assert.deepEqual(parseDispatch('--auto review the tests'), { task: 'review the tests', mode: 'fork', returnMode: 'auto' });
    assert.deepEqual(parseDispatch('--auto --pack review'), { task: 'review', mode: 'pack', returnMode: 'auto' });
    assert.deepEqual(parseDispatch('--pack --auto review'), { task: 'review', mode: 'pack', returnMode: 'auto' });
    assert.deepEqual(parseDispatch('--pack'), { task: '', mode: 'pack', returnMode: 'held' });
    assert.deepEqual(parseDispatch('--package the release'), { task: '--package the release', mode: 'fork', returnMode: 'held' });
    assert.deepEqual(parseDispatch('fix it --auto'), { task: 'fix it --auto', mode: 'fork', returnMode: 'held' }, 'flags only count at the start');
  });

  it('recognises only the exact agent control words', () => {
    assert.deepEqual(parseAgentControl('agents'), { name: 'agents' });
    assert.deepEqual(parseAgentControl('log 1a2b'), { name: 'log', id: '1a2b' });
    assert.deepEqual(parseAgentControl('cancel 1a2b3c4d'), { name: 'cancel', id: '1a2b3c4d' });
    assert.deepEqual(parseAgentControl('dispatch 2'), { name: 'dispatch', position: 2, mode: 'fork', returnMode: 'held' });
    assert.deepEqual(parseAgentControl('dispatch 2 --pack'), { name: 'dispatch', position: 2, mode: 'pack', returnMode: 'held' });
    assert.deepEqual(parseAgentControl('dispatch 2 --auto --pack'), { name: 'dispatch', position: 2, mode: 'pack', returnMode: 'auto' });
    for (const text of [' agents', 'agents please', 'log', 'log XYZ', 'log a', 'cancel 1a2b extra', 'dispatch', 'dispatch two', 'dispatch 2 --fast', 'dispatch 2 --pack x', 'dispatch 2 --auto --auto']) {
      assert.equal(parseAgentControl(text), null, text);
    }
  });
});

describe('">> task" in the prompt', () => {
  it('starts an agent, blocks the prompt with a receipt and never reaches the session', async () => {
    const receipt = reply(type('>> review the tests of module X'));
    const agent = onlyAgent();
    assert.match(receipt, new RegExp(`^Dispatched to agent ${agent.id}: it inherits this conversation\\. Follow it in the hub \\(/cmc\\) or with ";;agents"\\.`));
    assert.match(receipt, /not a git repository, so the agent works in this same folder/);
    assert.equal(agent.task, 'review the tests of module X');
    assert.equal(agent.mode, 'fork');
    assert.equal(agent.cwd, work);
    assert.deepEqual(listMessages(dir).messages, [], 'nothing is held');
    assert.equal((await ended(agent.id)).state, 'finished');
  });

  it('starts a pack agent with ">> --pack task", using the session transcript', async () => {
    const receipt = reply(type('>> --pack check the README'));
    const agent = onlyAgent();
    assert.match(receipt, /it gets a short summary of this conversation/);
    assert.equal(agent.mode, 'pack');
    assert.equal(agent.contextWarning, null);
    assert.match(readFileSync(join(agent.dir, 'prompt.txt'), 'utf8'), /First request of the user there: Add a --json flag/);
  });

  it('explains an empty task and starts nothing', () => {
    assert.match(reply(type('>>   ')), /^Nothing to dispatch\./);
    assert.match(reply(type('>> --pack')), /^Nothing to dispatch\./);
    assert.deepEqual(listAgents(dir), []);
  });

  it('lets through a prompt that only mentions >> later on', () => {
    assert.equal(type('use the >> operator here'), null);
  });

  it('says the agent only knows the task when the transcript cannot be read', () => {
    const receipt = reply(
      handlePrompt(
        { session_id: SESSION, prompt: '>> --pack do it', cwd: work, transcript_path: join(base, 'missing.jsonl') },
        { dataDir, claude: [process.execPath, fake], env: { ...process.env, FAKE_CLAUDE: 'ok' } },
      ),
    );
    assert.match(receipt, /It starts knowing only the task: The transcript of the session could not be read/);
  });
});

describe('agent control words', () => {
  it('lists the agents with state, duration and where they work', async () => {
    assert.match(reply(type(';;agents')), /^No agents have been dispatched from this session\./);
    type('>> first task');
    const first = onlyAgent();
    await ended(first.id);
    type('>> second task, still going', 'slow');
    const list = reply(type(';;agents'));
    assert.match(list, /^2 dispatched agents:\n/);
    assert.match(list, new RegExp(`${first.id} {2}finished +\\d+s {2}same folder {2}first task`));
    assert.match(list, /(starting|running) +\d+s {2}same folder {2}second task, still going/);
  });

  it('shows the final answer of a finished agent', async () => {
    type('>> look around');
    const agent = await ended(onlyAgent().id);
    const log = reply(type(`;;log ${agent.id.slice(0, 4)}`));
    assert.match(log, new RegExp(`^Agent ${agent.id} — finished, \\d+s, same folder\\nTask: look around\\n\\nIts final answer:\\nSummary: changed notes\\.txt\\.`));
  });

  it('shows why an agent failed', async () => {
    type('>> break', 'fail');
    const agent = await ended(onlyAgent().id);
    assert.match(reply(type(`;;log ${agent.id}`)), /What went wrong:\n.*something broke/);
  });

  it('cancels a running agent', async () => {
    type('>> takes long', 'slow');
    const agent = onlyAgent();
    for (let i = 0; i < 100 && findAgent(dir, agent.id).state !== 'running'; i += 1) await pause(50);
    assert.equal(reply(type(`;;cancel ${agent.id}`)), `Agent ${agent.id} cancelled.`);
    assert.equal(findAgent(dir, agent.id).state, 'cancelled');
    assert.match(reply(type(`;;cancel ${agent.id}`)), /^Not done: Agent .* is not running \(cancelled\)\./);
  });

  it('explains an unknown agent', () => {
    assert.equal(reply(type(';;log abcd')), 'Not done: There is no dispatched agent "abcd".');
  });

  it('dispatches a held message, which leaves the queue only once the agent has started', async () => {
    addMessage(dir, { text: 'stays held' });
    addMessage(dir, { text: 'update the changelog' });
    const receipt = reply(type(';;dispatch 2'));
    assert.match(receipt, /^Held message 2 left the queue\. Dispatched to agent [a-f0-9]{8}/);
    assert.equal(onlyAgent().task, 'update the changelog');
    assert.deepEqual(listMessages(dir).messages.map((message) => message.text), ['stays held']);
    assert.equal(reply(type(';;dispatch 5')), 'Not done: There is no held message 5 (the queue has 1).');
    await ended(onlyAgent().id);
  });

  it('keeps the held message when the agent cannot be started', () => {
    addMessage(dir, { text: 'precious' });
    // A file where the agents folder should be makes the dispatch fail before any process starts.
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'agents'), '');
    try {
      assert.throws(() => type(';;dispatch 1'));
      assert.deepEqual(listMessages(dir).messages.map((message) => message.text), ['precious']);
    } finally {
      rmSync(join(dir, 'agents'));
    }
  });

  it('explains a task that is too long', () => {
    assert.match(reply(type(`>> ${'x'.repeat(20001)}`)), /^Not done: A dispatched task can be at most/);
    assert.deepEqual(listAgents(dir), []);
  });
});

describe('formatting', () => {
  it('writes durations compactly', () => {
    const start = '2026-11-21T10:00:00.000Z';
    assert.equal(formatDuration(start, '2026-11-21T10:00:42.000Z'), '42s');
    assert.equal(formatDuration(start, '2026-11-21T10:03:05.000Z'), '3m 05s');
    assert.equal(formatDuration(start, '2026-11-21T11:02:00.000Z'), '1h 02m');
    assert.equal(formatDuration(start, null, Date.parse('2026-11-21T10:00:09.000Z')), '9s');
    assert.equal(formatDuration('not a date', null), '?');
  });

  it('says where an agent with a worktree works, and when it left no changes', () => {
    const agent: AgentRecord = {
      id: '1a2b3c4d', task: 'x', state: 'running', mode: 'fork', cwd: '/w', worktree: 'cmc-1a2b3c4d', command: [],
      runnerPid: null, pid: null, startedAt: '2026-11-21T10:00:00.000Z', endedAt: null, exitCode: null, summary: null, dir: '/d',
    };
    const now = Date.parse('2026-11-21T10:00:05.000Z');
    assert.match(formatAgents([agent], now), /running +5s {2}branch worktree-cmc-1a2b3c4d {2}x$/);
    assert.match(formatAgents([{ ...agent, state: 'finished', endedAt: '2026-11-21T10:00:05.000Z', branch: null }], now), /no changes {2}x$/);
  });
});

describe('cmc CLI from another terminal', () => {
  it('dispatches, lists and shows an agent of the session started in the folder', async () => {
    handleSessionStart(
      { hook_event_name: 'SessionStart', session_id: SESSION, cwd: work, transcript_path: join(root, 'test', 'fixtures', 'transcript.jsonl') },
      { dataDir },
    );
    const cli = (...args: string[]) =>
      spawnSync(process.execPath, [join(root, 'plugins', 'cmc', 'bin', 'cmc.ts'), ...args], {
        cwd: work,
        encoding: 'utf8',
        env: { ...process.env, CMC_DATA_DIR: dataDir, CMC_CLAUDE_BIN: process.execPath, FAKE_CLAUDE: 'ok' },
      });
    // CMC_CLAUDE_BIN names one executable and the fake needs its script too, so
    // here plain node stands in for claude: the agent itself fails, and what is
    // checked is the dispatch side (record, prompt, listing, log).
    const dispatched = cli('dispatch', '--pack', 'summarise', 'the', 'changes');
    assert.equal(dispatched.status, 0, dispatched.stdout);
    assert.match(dispatched.stdout, /^Dispatched to agent [a-f0-9]{8}: it gets a short summary/);
    const agent = onlyAgent();
    assert.equal(agent.task, 'summarise the changes');
    assert.equal(agent.mode, 'pack');
    assert.match(readFileSync(join(agent.dir, 'prompt.txt'), 'utf8'), /First request of the user there: Add a --json flag/, 'the transcript comes from the session registry');
    assert.notEqual((await ended(agent.id)).state, 'finished');
    assert.match(cli('agents').stdout, new RegExp(`^1 dispatched agent:\\n${agent.id} `));
    assert.match(cli('log', agent.id).stdout, new RegExp(`^Agent ${agent.id} — `));
    assert.equal(cli('dispatch').status, 1);
    assert.equal(cli('log').status, 1);
  });
});
