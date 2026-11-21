// cmc — releasing held messages. Author: Peterson Sena (r3v3rs3).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { handlePrompt } from '../plugins/cmc/lib/capture.ts';
import { sessionDir } from '../plugins/cmc/lib/paths.ts';
import { listMessages } from '../plugins/cmc/lib/queue.ts';
import { formatRelease, handleStop, releaseAll } from '../plugins/cmc/lib/release.ts';
import { readState } from '../plugins/cmc/lib/session-state.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'plugins', 'cmc');
const SESSION = 'd0546eba-c080-415b-b5e2-863787cb5937';
const OTHER_SESSION = 'b06d5f9a-57e8-44f3-8b37-b14b890259fc';

let dataDir;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'cmc-release-'));
});
afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

const type = (prompt, session = SESSION) => handlePrompt({ session_id: session, prompt }, { dataDir });
const stop = (extra = {}) => handleStop({ hook_event_name: 'Stop', session_id: SESSION, ...extra }, { dataDir });
const held = (session = SESSION) => listMessages(sessionDir(dataDir, session)).messages.map((message) => message.text);
const message = (text) => ({ id: 'x', text, at: '2026-11-21T00:00:00.000Z', source: 'user' });

function run(script, args, options = {}) {
  return spawnSync(process.execPath, [join(root, script), ...args], { encoding: 'utf8', ...options });
}

describe('formatRelease', () => {
  it('numbers the messages in order under a factual header', () => {
    assert.equal(
      formatRelease([message('rename the flag'), message('then run the tests')], '/cmc:release'),
      '[cmc] The user released their held messages with "/cmc:release":\n1. rename the flag\n2. then run the tests',
    );
  });

  it('uses the singular for one message', () => {
    assert.equal(formatRelease([message('only one')], ';;end'), '[cmc] The user released their held message with ";;end":\n1. only one');
  });

  it('indents the following lines of a multi-line message under its number', () => {
    assert.equal(
      formatRelease([message('first line\n2. looks like another item'), message('real second')], '/cmc:release'),
      '[cmc] The user released their held messages with "/cmc:release":\n1. first line\n   2. looks like another item\n2. real second',
    );
  });
});

describe('releaseAll', () => {
  it('returns the text once and empties the queue', () => {
    type(';; one');
    type(';; two');
    const first = releaseAll(dataDir, SESSION, '/cmc:release');
    assert.equal(first.count, 2);
    assert.match(first.text, /1\. one\n2\. two$/);
    assert.deepEqual(releaseAll(dataDir, SESSION, '/cmc:release'), { count: 0, text: null, warning: undefined });
  });

  it('only touches the queue of its own session', () => {
    type(';; mine');
    type(';; theirs', OTHER_SESSION);
    releaseAll(dataDir, SESSION, '/cmc:release');
    assert.deepEqual(held(OTHER_SESSION), ['theirs']);
  });
});

describe('release at the end of the turn', () => {
  it('lets the turn end when the user did not ask for it', () => {
    type(';; stays held');
    assert.equal(stop(), null);
    assert.deepEqual(held(), ['stays held']);
  });

  it('delivers the whole queue in one continuation after ";;end"', () => {
    type(';; one');
    type(';; two');
    assert.deepEqual(type(';;end'), { decision: 'block', reason: '2 held message(s) will be released when this turn ends.' });
    assert.deepEqual(stop(), {
      decision: 'block',
      reason: '[cmc] The user released their held messages with ";;end":\n1. one\n2. two',
    });
    assert.deepEqual(held(), []);
  });

  it('is a one-shot: the next turn ends normally', () => {
    type(';; one');
    type(';;end');
    stop();
    type(';; later');
    assert.equal(stop(), null);
    assert.deepEqual(held(), ['later']);
  });

  it('does nothing while a Stop hook continuation is already running', () => {
    type(';; one');
    type(';;end');
    assert.equal(stop({ stop_hook_active: true }), null);
    assert.deepEqual(held(), ['one'], 'nothing is lost: it is delivered at the next clean stop');
    assert.match(stop().reason, /1\. one$/);
  });

  it('does nothing with an empty queue, and disarms', () => {
    assert.match(type(';;end').reason, /^Nothing is held yet\./);
    assert.equal(stop(), null);
    assert.equal(readState(sessionDir(dataDir, SESSION)).atEnd, null);
  });

  it('covers messages held after ";;end" in the same turn', () => {
    type(';;end');
    type(';; typed afterwards');
    assert.match(stop().reason, /1\. typed afterwards$/);
  });

  it('holds ";; end" (with a space) as an ordinary message', () => {
    type(';; end');
    assert.deepEqual(held(), ['end']);
    assert.equal(stop(), null);
  });

  it('survives a damaged state file', () => {
    type(';; one');
    writeFileSync(join(sessionDir(dataDir, SESSION), 'state.json'), '{not json');
    assert.equal(stop(), null);
    assert.deepEqual(held(), ['one']);
  });
});

describe('stop-release hook script', () => {
  const runHookScript = (input) =>
    run('hooks/stop-release.ts', [], { input: JSON.stringify(input), env: { ...process.env, CLAUDE_PLUGIN_DATA: dataDir } });

  it('prints the block decision when delivery was requested', () => {
    type(';; from the hook');
    type(';;end');
    const result = runHookScript({ session_id: SESSION, stop_hook_active: false });
    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(result.stdout), {
      decision: 'block',
      reason: '[cmc] The user released their held message with ";;end":\n1. from the hook',
    });
  });

  it('prints nothing otherwise', () => {
    type(';; held');
    const result = runHookScript({ session_id: SESSION, stop_hook_active: false });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  });

  it('lets the turn end and logs when it fails', () => {
    const result = runHookScript({ session_id: '../escape' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.match(readFileSync(join(dataDir, 'cmc.log'), 'utf8'), /"event":"stop-release failed"/);
  });
});

describe('cmc drain', () => {
  const drain = (...args) => run('bin/cmc.ts', ['drain', '--data-dir', dataDir, ...args]);

  it('prints the release text and empties the queue', () => {
    type(';; one');
    type(';; two');
    const result = drain('--session', SESSION);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '[cmc] The user released their held messages with "/cmc:release":\n1. one\n2. two\n');
    assert.deepEqual(held(), []);
  });

  it('says so when nothing is held', () => {
    const result = drain('--session', SESSION);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /no messages are held/);
  });

  it('prints JSON on request', () => {
    type(';; one');
    assert.equal(JSON.parse(drain('--session', SESSION, '--format', 'json').stdout).count, 1);
  });

  it('never runs the text of a message as a command', () => {
    type(';; $(echo INJECTED) `echo INJECTED` "; echo INJECTED');
    assert.match(drain('--session', SESSION).stdout, /1\. \$\(echo INJECTED\) `echo INJECTED` "; echo INJECTED\n$/);
  });

  it('fails with a readable message on bad usage', () => {
    for (const args of [[], ['--session'], ['--session', SESSION, '--format', 'xml'], ['--session', '../escape'], ['--nope']]) {
      const result = drain(...args);
      assert.equal(result.status, 1, args.join(' '));
      assert.match(result.stdout, /^\[cmc\] /);
    }
    assert.equal(run('bin/cmc.ts', ['frobnicate']).status, 1);
    assert.match(run('bin/cmc.ts', []).stdout, /^cmc — Claude Message Control/);
  });

  it('falls back to CLAUDE_PLUGIN_DATA when --data-dir was not expanded', () => {
    type(';; one');
    const result = run('bin/cmc.ts', ['drain', '--data-dir', '${CLAUDE_PLUGIN_DATA}', '--session', SESSION], {
      env: { ...process.env, CLAUDE_PLUGIN_DATA: dataDir },
    });
    assert.match(result.stdout, /1\. one\n$/);
  });
});
