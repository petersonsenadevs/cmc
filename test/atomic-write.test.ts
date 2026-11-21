// cmc — atomic file replacement and its retry on Windows. Author: Peterson Sena (r3v3rs3).
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { writeFileAtomic } from '../plugins/cmc/lib/atomic-write.ts';
import { addMessage, listMessages } from '../plugins/cmc/lib/queue.ts';

let dir;
let file;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cmc-atomic-'));
  file = join(dir, 'target.json');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const failure = (code) => Object.assign(new Error(`${code}: simulated`), { code });

/** A rename that fails a number of times with a code before doing the real thing. */
function flakyRename(code, failures) {
  const state = { calls: 0 };
  const rename = (from, to) => {
    state.calls += 1;
    if (state.calls <= failures) throw failure(code);
    renameSync(from, to);
  };
  return { rename, state };
}

describe('writeFileAtomic', () => {
  it('creates the file and replaces it, leaving no temporary file', () => {
    writeFileAtomic(file, 'one');
    assert.equal(readFileSync(file, 'utf8'), 'one');
    writeFileAtomic(file, 'two');
    assert.equal(readFileSync(file, 'utf8'), 'two');
    assert.deepEqual(readdirSync(dir), ['target.json']);
  });

  for (const code of ['EPERM', 'EBUSY', 'EACCES']) {
    it(`retries a rename that fails with ${code} on Windows`, () => {
      writeFileSync(file, 'old');
      const { rename, state } = flakyRename(code, 3);
      const waits = [];
      writeFileAtomic(file, 'new', { rename, platform: 'win32', wait: (ms) => waits.push(ms) });
      assert.equal(state.calls, 4);
      assert.equal(waits.length, 3);
      assert.ok(waits.every((ms) => ms > 0));
      assert.equal(readFileSync(file, 'utf8'), 'new');
      assert.deepEqual(readdirSync(dir), ['target.json']);
    });
  }

  it('gives up after a bounded number of attempts, keeping the old file and no temporary one', () => {
    writeFileSync(file, 'old');
    const { rename, state } = flakyRename('EBUSY', Infinity);
    const waits = [];
    assert.throws(() => writeFileAtomic(file, 'new', { rename, platform: 'win32', wait: (ms) => waits.push(ms) }), { code: 'EBUSY' });
    assert.ok(state.calls > 1 && state.calls <= 20, `bounded attempts, got ${state.calls}`);
    assert.ok(waits.reduce((sum, ms) => sum + ms, 0) <= 3000, 'the whole wait stays well inside a hook timeout');
    assert.equal(readFileSync(file, 'utf8'), 'old');
    assert.deepEqual(readdirSync(dir), ['target.json']);
  });

  it('does not retry those codes away from Windows, where they are real errors', () => {
    for (const platform of ['linux', 'darwin']) {
      const { rename, state } = flakyRename('EPERM', 1);
      assert.throws(() => writeFileAtomic(file, 'new', { rename, platform, wait: () => assert.fail('must not wait') }), { code: 'EPERM' });
      assert.equal(state.calls, 1);
    }
    assert.deepEqual(readdirSync(dir), []);
  });

  it('does not retry an error that is not transient', () => {
    const { rename, state } = flakyRename('ENOSPC', 1);
    assert.throws(() => writeFileAtomic(file, 'new', { rename, platform: 'win32', wait: () => assert.fail('must not wait') }), { code: 'ENOSPC' });
    assert.equal(state.calls, 1);
    assert.deepEqual(readdirSync(dir), []);
  });

  it('fails without leaving anything behind when the folder does not exist', () => {
    assert.throws(() => writeFileAtomic(join(dir, 'missing', 'target.json'), 'new'), { code: 'ENOENT' });
    assert.deepEqual(readdirSync(dir), []);
  });

  it('is what the queue writes through: no temporary file stays next to it', () => {
    addMessage(dir, { text: 'one' });
    addMessage(dir, { text: 'two' });
    assert.equal(listMessages(dir).messages.length, 2);
    assert.deepEqual(readdirSync(dir), ['queue.jsonl']);
  });
});
