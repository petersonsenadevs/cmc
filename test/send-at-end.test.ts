// cmc — held messages go to the agent by themselves when its turn ends (sendAtEnd). Author: Peterson Sena (r3v3rs3).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { handlePrompt } from '../plugins/cmc/lib/capture.ts';
import { sessionDir } from '../plugins/cmc/lib/paths.ts';
import { addMessage, listMessages } from '../plugins/cmc/lib/queue.ts';
import { formatHeldAtEnd, handleStop, holdReceipt } from '../plugins/cmc/lib/release.ts';
import { readState } from '../plugins/cmc/lib/session-state.ts';
import { blocked } from '../test-support/expect.ts';

const SESSION = '7c2e4a19-3b5d-4f8e-a6c1-9d0b2e4f6a81';

let dataDir: string;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'cmc-send-at-end-'));
});
afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

const dir = () => sessionDir(dataDir, SESSION);
const type = (prompt: string) => handlePrompt({ session_id: SESSION, prompt }, { dataDir });
const stop = (extra: { stop_hook_active?: boolean } = {}) => handleStop({ hook_event_name: 'Stop', session_id: SESSION, ...extra }, { dataDir });
const held = () => listMessages(dir()).messages.map((message) => message.text);

describe('sendAtEnd (the default)', () => {
  it('hands what was held while the agent worked over when its turn ends, without any command', () => {
    type('count to three'); // a normal prompt: the agent is now working
    assert.equal(blocked(type(';; also say pineapple')).reason, holdReceipt(1, true));
    const reason = blocked(stop()).reason;
    assert.equal(reason, '[cmc] The user typed this message while you were working; cmc held it until your turn ended:\n1. also say pineapple');
    assert.deepEqual(held(), []);
    assert.equal(readState(dir()).turnActive, true, 'the turn goes on with the messages');
    assert.equal(stop(), null, 'and then ends normally');
    assert.equal(readState(dir()).turnActive, false);
  });

  it('keeps the order and the edits made before the turn ends', () => {
    type('work on it');
    type(';; one');
    type(';; two');
    type(';;edit 2 two, edited');
    type(';;top 2');
    assert.match(blocked(stop()).reason, /these messages while you were working; cmc held them until your turn ended:\n1\. two, edited\n2\. one$/);
  });

  it('sends nothing deleted before the turn ends', () => {
    type('work on it');
    type(';; one');
    type(';;rm 1');
    assert.equal(stop(), null);
  });

  it('delivers even when another plugin\'s Stop hook is continuing the turn', () => {
    type('work on it');
    type(';; one');
    assert.match(blocked(stop({ stop_hook_active: true })).reason, /1\. one$/);
  });

  it('leaves the results of agents to their return mode', () => {
    type('work on it');
    addMessage(dir(), { text: 'agent finished', source: 'agent 1a2b3c4d' });
    assert.equal(stop(), null);
    assert.deepEqual(held(), ['agent finished']);
  });

  it('says what will happen in the receipt: at the end of the turn, or when the user sends it', () => {
    assert.equal(blocked(type(';; while idle')).reason, holdReceipt(1, false));
    assert.equal(holdReceipt(1, false), 'Held (1 queued). /held or /send to send it.');
    type('work on it');
    assert.equal(holdReceipt(2, true), 'Held (2 queued). It goes to the agent when its turn ends; /held to change or delete it.');
    assert.equal(blocked(type(';; while working')).reason, holdReceipt(2, true));
  });

  it('words one message and several correctly', () => {
    const at = '2026-11-21T00:00:00.000Z';
    assert.match(formatHeldAtEnd([{ id: 'a', text: 'x', at, source: 'user' }]), /typed this message .* held it until/);
    assert.match(
      formatHeldAtEnd([
        { id: 'a', text: 'x', at, source: 'user' },
        { id: 'b', text: 'y', at, source: 'user' },
      ]),
      /typed these messages .* held them until/,
    );
  });
});

describe('sendAtEnd: false', () => {
  it('keeps the messages held until the user sends them', () => {
    writeFileSync(join(dataDir, 'config.json'), JSON.stringify({ sendAtEnd: false }));
    type('work on it');
    assert.equal(blocked(type(';; keep me')).reason, holdReceipt(1, false));
    assert.equal(stop(), null);
    assert.deepEqual(held(), ['keep me']);
  });
});
