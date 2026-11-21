// cmc — a dispatched agent works in its own git worktree. Author: Peterson Sena (r3v3rs3).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findAgent, isAlive, listAgents, type AgentRecord } from '../plugins/cmc/lib/agents-registry.ts';
import { cancelAgent, dispatch } from '../plugins/cmc/lib/dispatch.ts';
import { sessionDir } from '../plugins/cmc/lib/paths.ts';
import { changedFiles, findWorktree, findWorktreeEntry, headCommit, isGitRepo, isStaleSessionLock, settleWorktree, worktreeBranch, worktreeName } from '../plugins/cmc/lib/worktree.ts';

const fake = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-support', 'fake-claude.ts');
const SESSION = 'd0546eba-c080-415b-b5e2-863787cb5937';
const IDENTITY = ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid'];

let base: string;
let repo: string;
let dir: string;

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  // Real path: git prints real paths, and macOS keeps its temp folder behind a link.
  base = realpathSync.native(mkdtempSync(join(tmpdir(), 'cmc-worktree-')));
  repo = join(base, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'notes.txt'), 'original\n');
  git(repo, 'add', '.');
  git(repo, ...IDENTITY, 'commit', '-q', '-m', 'init');
  dir = sessionDir(join(base, 'data'), SESSION);
});

afterEach(async () => {
  const agents = listAgents(dir);
  for (const agent of agents) {
    if (agent.state === 'running' || agent.state === 'starting') cancelAgent(dir, agent.id);
  }
  const pids = agents.flatMap((agent) => [agent.runnerPid, agent.pid]);
  for (let i = 0; i < 100 && pids.some(isAlive); i += 1) await pause(50);
  try {
    rmSync(base, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  } catch (error) {
    // The agents of these tests have to start inside the repository, and Windows
    // keeps a folder locked for a while after a process that worked in it exits.
    // The scratch folder is then left for the system to clean; on other systems
    // a failure to remove it is a real error.
    if (process.platform !== 'win32') throw error;
  }
});

/** Makes a worktree the way Claude Code does for `--worktree <name>`. */
function addWorktree(name: string): string {
  const path = join(repo, '.claude', 'worktrees', name);
  git(repo, 'worktree', 'add', '-q', '-b', worktreeBranch(name), path);
  return path;
}

function start(task: string, behaviour: string, cwd = repo): AgentRecord {
  return dispatch({
    sessionDir: dir,
    sessionId: SESSION,
    task,
    cwd,
    claude: [process.execPath, fake],
    env: { ...process.env, FAKE_CLAUDE: behaviour },
  });
}

async function ended(id: string): Promise<AgentRecord> {
  for (let i = 0; i < 300; i += 1) {
    const agent = findAgent(dir, id);
    // The supervisor notes the worktree right after the final state.
    if (agent.state !== 'starting' && agent.state !== 'running' && (agent.worktree === null || agent.changedFiles !== undefined)) return agent;
    await pause(50);
  }
  throw new Error(`agent ${id} did not end: ${JSON.stringify(findAgent(dir, id))}`);
}

describe('worktree helpers', () => {
  it('tells a git repository from a plain folder', () => {
    assert.equal(isGitRepo(repo), true);
    assert.equal(isGitRepo(base), false);
    assert.match(headCommit(repo) ?? '', /^[0-9a-f]{40}$/);
    assert.equal(headCommit(base), null);
  });

  it('names the worktree and its branch after the agent', () => {
    assert.equal(worktreeName('1a2b3c4d'), 'cmc-1a2b3c4d');
    assert.equal(worktreeBranch('cmc-1a2b3c4d'), 'worktree-cmc-1a2b3c4d');
  });

  it('finds a worktree by its branch, and nothing when there is none', () => {
    const path = addWorktree('cmc-aaaaaaaa');
    assert.equal(findWorktree(repo, 'cmc-aaaaaaaa'), path);
    assert.equal(findWorktree(repo, 'cmc-bbbbbbbb'), null);
    assert.equal(findWorktree(base, 'cmc-aaaaaaaa'), null);
  });

  it('lists what changed: edited, new and committed files', () => {
    const path = addWorktree('cmc-aaaaaaaa');
    const start = headCommit(repo);
    assert.deepEqual(changedFiles(path, start), []);
    writeFileSync(join(path, 'notes.txt'), 'edited\n');
    writeFileSync(join(path, 'new file.txt'), 'new\n');
    assert.deepEqual(changedFiles(path, start), ['new file.txt', 'notes.txt']);
    git(path, 'add', '.');
    git(path, ...IDENTITY, 'commit', '-q', '-m', 'work');
    assert.deepEqual(changedFiles(path, start), ['new file.txt', 'notes.txt'], 'committed work still counts');
  });

  it('removes a clean worktree and its branch', () => {
    const path = addWorktree('cmc-aaaaaaaa');
    assert.deepEqual(settleWorktree(repo, 'cmc-aaaaaaaa', headCommit(repo)), {
      path: null,
      branch: 'worktree-cmc-aaaaaaaa',
      files: [],
      kept: false,
    });
    assert.equal(existsSync(path), false);
    assert.equal(git(repo, 'branch', '--list', 'worktree-cmc-aaaaaaaa'), '');
  });

  it('keeps a worktree with work in it and says which files', () => {
    const path = addWorktree('cmc-aaaaaaaa');
    writeFileSync(join(path, 'notes.txt'), 'edited\n');
    assert.deepEqual(settleWorktree(repo, 'cmc-aaaaaaaa', headCommit(repo)), {
      path,
      branch: 'worktree-cmc-aaaaaaaa',
      files: ['notes.txt'],
      kept: true,
    });
    assert.equal(readFileSync(join(path, 'notes.txt'), 'utf8'), 'edited\n');
  });

  it('lifts the lock a finished Claude Code session left behind, then removes a clean worktree', () => {
    const path = addWorktree('cmc-aaaaaaaa');
    git(repo, 'worktree', 'lock', '--reason', 'claude session cmc-aaaaaaaa (pid 2147483646)', path);
    assert.equal(findWorktreeEntry(repo, 'cmc-aaaaaaaa')?.lockReason, 'claude session cmc-aaaaaaaa (pid 2147483646)');
    assert.equal(settleWorktree(repo, 'cmc-aaaaaaaa', headCommit(repo)).kept, false);
    assert.equal(existsSync(path), false);
  });

  it('lifts that lock on a worktree it keeps, so plain git can handle it', () => {
    const path = addWorktree('cmc-aaaaaaaa');
    writeFileSync(join(path, 'notes.txt'), 'edited\n');
    git(repo, 'worktree', 'lock', '--reason', 'claude session cmc-aaaaaaaa (pid 2147483646)', path);
    assert.equal(settleWorktree(repo, 'cmc-aaaaaaaa', headCommit(repo)).kept, true);
    assert.equal(findWorktreeEntry(repo, 'cmc-aaaaaaaa')?.lockReason, null);
  });

  it('leaves alone a lock that is not a finished session of this agent', () => {
    const path = addWorktree('cmc-aaaaaaaa');
    for (const reason of ['kept by hand', `claude session cmc-aaaaaaaa (pid ${process.pid})`, 'claude session cmc-zzzzzzzz (pid 2147483646)']) {
      git(repo, 'worktree', 'lock', '--reason', reason, path);
      assert.equal(isStaleSessionLock(reason, 'cmc-aaaaaaaa'), false, reason);
      const outcome = settleWorktree(repo, 'cmc-aaaaaaaa', headCommit(repo));
      assert.equal(outcome.kept, true, reason);
      assert.equal(findWorktreeEntry(repo, 'cmc-aaaaaaaa')?.lockReason, reason);
      git(repo, 'worktree', 'unlock', path);
    }
    assert.equal(isStaleSessionLock(null, 'cmc-aaaaaaaa'), false);
    assert.equal(isStaleSessionLock('claude session cmc-aaaaaaaa (pid 2147483646)', 'cmc-aaaaaaaa'), true);
  });

  it('reports nothing for a worktree that was never created', () => {
    assert.deepEqual(settleWorktree(repo, 'cmc-cccccccc', headCommit(repo)), {
      path: null,
      branch: 'worktree-cmc-cccccccc',
      files: [],
      kept: false,
    });
  });
});

describe('dispatch with isolation', () => {
  it('gives the agent its own worktree in a git repository', async () => {
    const agent = start('change the notes', 'edit');
    assert.equal(agent.worktree, `cmc-${agent.id}`);
    assert.equal(agent.baseCommit, headCommit(repo));
    assert.deepEqual(agent.command.slice(-2), ['--worktree', `cmc-${agent.id}`]);

    const done = await ended(agent.id);
    assert.equal(done.state, 'finished');
    assert.equal(done.branch, `worktree-cmc-${agent.id}`);
    assert.deepEqual(done.changedFiles, ['notes.txt']);
    assert.equal(done.worktreePath, join(repo, '.claude', 'worktrees', `cmc-${agent.id}`));
    assert.equal(readFileSync(join(repo, 'notes.txt'), 'utf8'), 'original\n', 'the main folder is untouched');
    assert.equal(readFileSync(join(done.worktreePath ?? '', 'notes.txt'), 'utf8'), 'changed by the agent\n');
  });

  it('keeps the worktree when the agent committed its work', async () => {
    const done = await ended(start('change and commit', 'commit').id);
    assert.deepEqual(done.changedFiles, ['notes.txt']);
    assert.equal(git(repo, 'branch', '--list', done.branch ?? ''), `+ ${done.branch}`);
  });

  it('cleans up after an agent that changed nothing', async () => {
    const agent = start('only look', 'ok');
    const done = await ended(agent.id);
    assert.equal(done.state, 'finished');
    assert.deepEqual(done.changedFiles, []);
    assert.equal(done.worktreePath, null);
    assert.equal(done.branch, null);
    assert.equal(findWorktree(repo, `cmc-${agent.id}`), null);
    assert.equal(git(repo, 'branch', '--list', `worktree-cmc-${agent.id}`), '');
  });

  it('works in the folder itself when there is no git repository', async () => {
    const plain = join(base, 'plain');
    mkdirSync(plain);
    const agent = start('no git here', 'ok', plain);
    assert.equal(agent.worktree, null);
    assert.equal(agent.command.includes('--worktree'), false);
    const done = await ended(agent.id);
    assert.equal(done.state, 'finished');
    assert.equal(done.changedFiles, undefined);
  });

  it('lets the caller turn the isolation off', () => {
    const agent = dispatch({
      sessionDir: dir,
      sessionId: SESSION,
      task: 'share the folder',
      cwd: repo,
      worktree: null,
      claude: [process.execPath, fake],
      env: { ...process.env, FAKE_CLAUDE: 'ok' },
    });
    assert.equal(agent.worktree, null);
    assert.equal(agent.command.includes('--worktree'), false);
  });
});
