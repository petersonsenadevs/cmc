// cmc — session registry and the command line from another terminal. Author: Peterson Sena (r3v3rs3).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { sessionDir } from '../lib/paths.mjs';
import { listMessages } from '../lib/queue.mjs';
import { handleStop } from '../lib/release.mjs';
import { candidateDataDirs, handleSessionEnd, handleSessionStart, listSessions, resolveSession } from '../lib/sessions.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIRST = 'd0546eba-c080-415b-b5e2-863787cb5937';
const SECOND = 'b06d5f9a-57e8-44f3-8b37-b14b890259fc';

let base;
let dataDir;
let project;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'cmc-sessions-'));
  dataDir = join(base, 'data');
  project = join(base, 'project');
  mkdirSync(join(project, 'src', 'deep'), { recursive: true });
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

const start = (id, cwd = project) => handleSessionStart({ hook_event_name: 'SessionStart', session_id: id, cwd }, { dataDir });
const end = (id) => handleSessionEnd({ hook_event_name: 'SessionEnd', session_id: id }, { dataDir });
const held = (id) => listMessages(sessionDir(dataDir, id)).messages.map((message) => message.text);
const find = (cwd, wanted) => resolveSession({ dataDirs: [dataDir], cwd, wanted });

function cmc(args, { cwd = project, env = { CMC_DATA_DIR: dataDir } } = {}) {
  const clean = { ...process.env };
  delete clean.CLAUDE_PLUGIN_DATA;
  delete clean.CMC_DATA_DIR;
  return spawnSync(process.execPath, [join(root, 'bin', 'cmc.mjs'), ...args], { cwd, encoding: 'utf8', env: { ...clean, ...env } });
}

describe('session registry', () => {
  it('records the session with its folder and marks the data directory', () => {
    assert.equal(start(FIRST), null);
    const [record] = listSessions([dataDir]);
    assert.equal(record.id, FIRST);
    assert.equal(record.cwd, project);
    assert.equal(record.endedAt, null);
    assert.ok(Date.parse(record.startedAt) > 0);
    assert.deepEqual(JSON.parse(readFileSync(join(dataDir, 'cmc.json'), 'utf8')), { plugin: 'cmc' });
  });

  it('keeps the original start time when the session is resumed, and reopens it', () => {
    start(FIRST);
    const record = join(sessionDir(dataDir, FIRST), 'session.json');
    writeFileSync(record, JSON.stringify({ ...JSON.parse(readFileSync(record, 'utf8')), startedAt: '2026-01-01T00:00:00.000Z' }));
    end(FIRST);
    assert.ok(listSessions([dataDir])[0].endedAt);
    start(FIRST);
    const [resumed] = listSessions([dataDir]);
    assert.equal(resumed.startedAt, '2026-01-01T00:00:00.000Z');
    assert.equal(resumed.endedAt, null);
  });

  it('notes activity when a turn ends', () => {
    start(FIRST);
    const record = join(sessionDir(dataDir, FIRST), 'session.json');
    writeFileSync(record, JSON.stringify({ ...JSON.parse(readFileSync(record, 'utf8')), lastActiveAt: '2026-01-01T00:00:00.000Z' }));
    handleStop({ session_id: FIRST }, { dataDir });
    assert.ok(listSessions([dataDir])[0].lastActiveAt > '2026-11-01');
  });

  it('ignores folders without a readable record', () => {
    start(FIRST);
    mkdirSync(join(dataDir, 'sessions', 'no-record'));
    mkdirSync(join(dataDir, 'sessions', 'broken'));
    writeFileSync(join(dataDir, 'sessions', 'broken', 'session.json'), '{oops');
    assert.deepEqual(listSessions([dataDir]).map((record) => record.id), [FIRST]);
  });
});

describe('resolveSession', () => {
  it('finds the one open session of the folder', () => {
    start(FIRST);
    start(SECOND, join(base, 'elsewhere'));
    assert.equal(find(project).id, FIRST);
  });

  it('finds it from a subfolder too, preferring the closest session', () => {
    start(FIRST);
    assert.equal(find(join(project, 'src', 'deep')).id, FIRST);
    start(SECOND, join(project, 'src'));
    assert.equal(find(join(project, 'src', 'deep')).id, SECOND);
    assert.equal(find(project).id, FIRST);
  });

  it('does not confuse a folder with one that merely shares its prefix', () => {
    start(FIRST);
    assert.throws(() => find(`${project}-other`), { code: 'NO_SESSION' });
  });

  it('says so when no session is open there', () => {
    assert.throws(() => find(project), { code: 'NO_SESSION', message: /^No open Claude Code session with cmc was started in .*Nothing was done\./s });
    start(FIRST);
    end(FIRST);
    assert.throws(() => find(project), { code: 'NO_SESSION' });
  });

  it('asks to choose when several sessions share the folder', () => {
    start(FIRST);
    start(SECOND);
    assert.throws(() => find(project), (error) => {
      assert.equal(error.code, 'AMBIGUOUS_SESSION');
      assert.match(error.message, /^2 open sessions were started in this folder\. Nothing was done\. Pick one with --session <id>:/);
      assert.match(error.message, /d0546eba/);
      assert.match(error.message, /b06d5f9a/);
      return true;
    });
  });

  it('accepts an id or its beginning, even for a closed session', () => {
    start(FIRST);
    start(SECOND);
    end(SECOND);
    assert.equal(find(project, 'b06d').id, SECOND);
    assert.equal(find(base, FIRST).id, FIRST);
    assert.throws(() => find(project, 'ffff'), { code: 'NO_SESSION' });
  });
});

describe('candidateDataDirs', () => {
  it('scans the Claude config directory for data directories marked by cmc', () => {
    const config = join(base, 'config');
    const mine = join(config, 'plugins', 'data', 'cmc-inline');
    const other = join(config, 'plugins', 'data', 'someone-else');
    mkdirSync(mine, { recursive: true });
    mkdirSync(other, { recursive: true });
    writeFileSync(join(mine, 'cmc.json'), '{"plugin":"cmc"}');

    const saved = { ...process.env };
    delete process.env.CMC_DATA_DIR;
    delete process.env.CLAUDE_PLUGIN_DATA;
    process.env.CLAUDE_CONFIG_DIR = config;
    try {
      assert.deepEqual(candidateDataDirs(), [mine]);
      assert.deepEqual(candidateDataDirs('${CLAUDE_PLUGIN_DATA}'), [mine]);
      assert.deepEqual(candidateDataDirs(other), [other]);
      process.env.CLAUDE_CONFIG_DIR = join(base, 'missing');
      assert.deepEqual(candidateDataDirs(), []);
    } finally {
      process.env = saved;
    }
  });
});

describe('cmc from another terminal', () => {
  it('holds a message in the session of the current folder', () => {
    start(FIRST);
    const result = cmc(['hold', 'also', 'update the README']);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'Held (1 queued).\n');
    assert.deepEqual(held(FIRST), ['also update the README']);
    assert.match(cmc(['list']).stdout, /^1 held message, in delivery order:/);
  });

  it('works from a subfolder of the project', () => {
    start(FIRST);
    assert.equal(cmc(['hold', 'from below'], { cwd: join(project, 'src', 'deep') }).status, 0);
    assert.deepEqual(held(FIRST), ['from below']);
  });

  it('stores nothing and explains when no session is open in the folder', () => {
    const result = cmc(['hold', 'lost?']);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /^\[cmc\] No open Claude Code session with cmc was started in /);
    assert.equal(existsSync(join(dataDir, 'sessions')), false);
  });

  it('asks to choose between several sessions and then obeys --session', () => {
    start(FIRST);
    start(SECOND);
    const ambiguous = cmc(['hold', 'which one?']);
    assert.equal(ambiguous.status, 1);
    assert.match(ambiguous.stdout, /^\[cmc\] 2 open sessions were started in this folder\. Nothing was done\./);
    assert.deepEqual([...held(FIRST), ...held(SECOND)], []);

    assert.equal(cmc(['hold', 'this one', '--session', 'b06d5f9a']).status, 0);
    assert.deepEqual(held(SECOND), ['this one']);
    assert.deepEqual(held(FIRST), []);
  });

  it('refuses an empty message', () => {
    start(FIRST);
    const result = cmc(['hold']);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '[cmc] There is no text to hold.\n');
  });

  it('finds the data directory by itself under the Claude config directory', () => {
    const config = join(base, 'config');
    dataDir = join(config, 'plugins', 'data', 'cmc-from-marketplace');
    start(FIRST);
    const result = cmc(['hold', 'found it'], { env: { CLAUDE_CONFIG_DIR: config } });
    assert.equal(result.stdout, 'Held (1 queued).\n');
    assert.deepEqual(held(FIRST), ['found it']);
  });

  it('lists the sessions of the folder, or all of them', () => {
    start(FIRST);
    start(SECOND, join(base, 'elsewhere'));
    const here = cmc(['sessions']).stdout;
    assert.match(here, /^Open sessions started in this folder:\n {2}d0546eba /);
    assert.doesNotMatch(here, /b06d5f9a/);
    assert.match(cmc(['sessions', '--all']).stdout, /b06d5f9a/);
    assert.match(cmc(['sessions'], { cwd: base }).stdout, /^No open session was started in this folder\./);
  });
});

describe('session-register hook script', () => {
  const run = (input) =>
    spawnSync(process.execPath, [join(root, 'hooks', 'session-register.mjs')], {
      input: JSON.stringify(input),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PLUGIN_DATA: dataDir },
    });

  it('registers on SessionStart and closes on SessionEnd, printing nothing', () => {
    const started = run({ hook_event_name: 'SessionStart', session_id: FIRST, cwd: project, source: 'startup' });
    assert.equal(started.status, 0);
    assert.equal(started.stdout, '');
    assert.equal(find(project).id, FIRST);

    assert.equal(run({ hook_event_name: 'SessionEnd', session_id: FIRST, reason: 'exit' }).stdout, '');
    assert.throws(() => find(project), { code: 'NO_SESSION' });
  });
});
