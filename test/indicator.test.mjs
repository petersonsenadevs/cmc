// cmc — held-messages indicator (hooks module), driven with a stand-in engine. Author: Peterson Sena (r3v3rs3).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { countHeld, register, statusFor } from '../hooks/indicator.mjs';

const SESSION = 'd0546eba-c080-415b-b5e2-863787cb5937';
const line = (text) => `${JSON.stringify({ id: 'x', text, at: '2026-11-21T00:00:00.000Z', source: 'user' })}\n`;

/** A minimal `$`: one queue file, a manual clock and a record of every status set. */
function engine() {
  const files = new Map();
  const statuses = [];
  let tick;
  const $ = {
    session: { id: async () => SESSION },
    process: { hookEnv: async () => ({ CLAUDE_PLUGIN_DATA: '/data' }) },
    fs: {
      read: async (path) => {
        if (!files.has(path)) throw new Error('missing');
        return files.get(path);
      },
    },
    clock: { every: (ms, fn) => { tick = fn; } },
    ui: { status: (text) => statuses.push(text) },
  };
  return { $, statuses, setQueue: (text) => files.set(`/data/sessions/${SESSION}/queue.jsonl`, text), tick: () => tick() };
}

async function start(world) {
  let hook;
  register((event, fn) => {
    assert.equal(event, 'session.start');
    hook = fn;
  });
  return hook(world.$, { source: 'startup' }, async (e) => ({ passed: e }));
}

describe('indicator', () => {
  it('counts one message per non-empty line', () => {
    assert.equal(countHeld(''), 0);
    assert.equal(countHeld(line('a')), 1);
    assert.equal(countHeld(`${line('a')}\n${line('b')}`), 2);
  });

  it('shows the count and clears with an empty queue', () => {
    assert.equal(statusFor(0), undefined);
    assert.equal(statusFor(1), '✉ 1 held');
    assert.equal(statusFor(2), '✉ 2 held');
  });

  it('lets the session start as usual and shows nothing while nothing is held', async () => {
    const world = engine();
    assert.deepEqual(await start(world), { passed: { source: 'startup' } });
    await world.tick();
    assert.deepEqual(world.statuses, []);
  });

  it('follows the queue as messages are held and released, touching the screen only on change', async () => {
    const world = engine();
    await start(world);
    world.setQueue(line('a'));
    await world.tick();
    await world.tick();
    world.setQueue(line('a') + line('b'));
    await world.tick();
    world.setQueue('');
    await world.tick();
    await world.tick();
    assert.deepEqual(world.statuses, ['✉ 1 held', '✉ 2 held', undefined]);
  });

  it('shows what was already held when the session is resumed', async () => {
    const world = engine();
    world.setQueue(line('a') + line('b'));
    await start(world);
    assert.deepEqual(world.statuses, ['✉ 2 held']);
  });
});
