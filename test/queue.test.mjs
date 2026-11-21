// cmc — queue behaviour. Author: Peterson Sena (r3v3rs3).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CmcError } from '../plugins/cmc/lib/errors.mjs';
import { resolveDataDir, sessionDir } from '../plugins/cmc/lib/paths.mjs';
import { addMessage, drainMessages, isLockHeld, listMessages, MAX_TEXT_LENGTH } from '../plugins/cmc/lib/queue.mjs';

const worker = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-support', 'queue-worker.mjs');

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve(stdout) : reject(new Error(`worker exited ${code}: ${stderr}`))));
  });
}

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cmc-queue-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('queue', () => {
  it('starts empty', () => {
    assert.deepEqual(listMessages(dir), { messages: [] });
  });

  it('holds messages in the order they arrive', () => {
    addMessage(dir, { text: 'first' });
    const second = addMessage(dir, { text: '  second  ' });
    assert.equal(second.messages.length, 2);
    assert.equal(second.message.text, 'second');
    assert.equal(second.message.source, 'user');
    assert.deepEqual(listMessages(dir).messages.map((message) => message.text), ['first', 'second']);
  });

  it('rejects empty and oversized text', () => {
    assert.throws(() => addMessage(dir, { text: '   ' }), { code: 'EMPTY_MESSAGE' });
    assert.throws(() => addMessage(dir, { text: 'x'.repeat(MAX_TEXT_LENGTH + 1) }), { code: 'MESSAGE_TOO_LONG' });
    assert.deepEqual(listMessages(dir).messages, []);
  });

  it('drains everything once', () => {
    addMessage(dir, { text: 'one' });
    addMessage(dir, { text: 'two' });
    const first = drainMessages(dir);
    assert.deepEqual(first.messages.map((message) => message.text), ['one', 'two']);
    assert.equal(first.remaining, 0);
    assert.deepEqual(drainMessages(dir).messages, []);
  });

  it('drains only the requested ids and keeps the rest in order', () => {
    const ids = ['one', 'two', 'three'].map((text) => addMessage(dir, { text }).message.id);
    const result = drainMessages(dir, [ids[1], 'unknown']);
    assert.deepEqual(result.messages.map((message) => message.text), ['two']);
    assert.equal(result.remaining, 2);
    assert.deepEqual(listMessages(dir).messages.map((message) => message.text), ['one', 'three']);
  });

  it('keeps multi-line text and special characters intact', () => {
    const text = 'line one\nline "two" `backticks` $(not a command) ñ ✉';
    addMessage(dir, { text });
    assert.equal(drainMessages(dir).messages[0].text, text);
  });

  it('repairs a damaged file, sets it aside and warns', () => {
    const kept = addMessage(dir, { text: 'survivor' }).message;
    const file = join(dir, 'queue.jsonl');
    writeFileSync(file, `${readFileSync(file, 'utf8')}{"broken": \n{"id":1,"text":"wrong types"}\n`);

    const result = listMessages(dir);
    assert.deepEqual(result.messages, [kept]);
    assert.match(result.warning, /1 message\(s\) kept, 2 unreadable line\(s\) set aside in queue\.corrupt-\d+\.jsonl/);
    assert.equal(readdirSync(dir).filter((name) => name.startsWith('queue.corrupt-')).length, 1);
    assert.equal(listMessages(dir).warning, undefined, 'the repaired file reads cleanly');
  });

  it('removes a stale lock left by a dead process', () => {
    addMessage(dir, { text: 'before' });
    const lock = join(dir, 'queue.lock');
    // A lock older than the stale threshold: created, then aged through its mtime.
    mkdirSync(lock);
    const old = new Date(Date.now() - 60000);
    utimesSync(lock, old, old);
    assert.equal(addMessage(dir, { text: 'after' }).messages.length, 2);
    assert.equal(existsSync(lock), false);
  });

  it('reads EPERM as "lock held" only on Windows; elsewhere it is a real error', () => {
    for (const platform of ['win32', 'linux', 'darwin']) assert.equal(isLockHeld({ code: 'EEXIST' }, platform), true);
    assert.equal(isLockHeld({ code: 'EPERM' }, 'win32'), true);
    assert.equal(isLockHeld({ code: 'EPERM' }, 'linux'), false);
    assert.equal(isLockHeld({ code: 'EPERM' }, 'darwin'), false);
    for (const platform of ['win32', 'linux', 'darwin']) assert.equal(isLockHeld({ code: 'EACCES' }, platform), false);
  });

  it('fails at once, not as a busy queue, when the lock cannot be created at all', () => {
    const started = Date.now();
    assert.throws(() => addMessage(join(dir, 'no-such-folder'), { text: 'x' }), { code: 'ENOENT' });
    assert.ok(Date.now() - started < 2000);
  });

  it('never hands a message to two drainers running at the same time', async () => {
    const stopFile = join(dir, 'writers-done');
    const perWriter = 60;
    const drainers = [1, 2, 3].map(() => run(['drain', dir, stopFile]));
    await Promise.all(['a', 'b'].map((label) => run(['add', dir, String(perWriter), label])));
    writeFileSync(stopFile, '');

    const delivered = (await Promise.all(drainers)).flatMap((output) => JSON.parse(output));
    const expected = ['a', 'b'].flatMap((label) => Array.from({ length: perWriter }, (_, i) => `${label}-${i}`));
    assert.equal(delivered.length, expected.length, 'every message delivered exactly once');
    assert.deepEqual([...delivered].sort(), [...expected].sort());
    assert.deepEqual(listMessages(dir).messages, []);
  });
});

describe('paths', () => {
  it('prefers the explicit data dir and ignores an unexpanded placeholder', () => {
    const previous = process.env.CLAUDE_PLUGIN_DATA;
    process.env.CLAUDE_PLUGIN_DATA = dir;
    try {
      assert.equal(resolveDataDir('${CLAUDE_PLUGIN_DATA}'), dir);
      assert.equal(resolveDataDir(join(dir, 'explicit')), join(dir, 'explicit'));
      delete process.env.CLAUDE_PLUGIN_DATA;
      assert.throws(() => resolveDataDir(''), { code: 'NO_DATA_DIR' });
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
      else process.env.CLAUDE_PLUGIN_DATA = previous;
    }
  });

  it('creates one folder per session and refuses ids that escape it', () => {
    const session = sessionDir(dir, 'd0546eba-c080-415b-b5e2-863787cb5937');
    assert.equal(session, join(dir, 'sessions', 'd0546eba-c080-415b-b5e2-863787cb5937'));
    assert.ok(existsSync(session));
    for (const bad of ['../evil', 'a/b', 'a\\b', '', '.', undefined]) {
      assert.throws(() => sessionDir(dir, bad), (error) => error instanceof CmcError && error.code === 'BAD_SESSION_ID');
    }
  });
});
