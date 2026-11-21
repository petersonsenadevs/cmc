// cmc — selective release, release "now" (idle or busy agent) and release armed from the CLI. Author: Peterson Sena (r3v3rs3).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { handlePrompt, type PromptBlock, type PromptContext } from '../plugins/cmc/lib/capture.ts';
import { parseControl } from '../plugins/cmc/lib/control.ts';
import { sessionDir } from '../plugins/cmc/lib/paths.ts';
import { addMessage, listMessages } from '../plugins/cmc/lib/queue.ts';
import { handleStop } from '../plugins/cmc/lib/release.ts';
import { mergeSelection, readState } from '../plugins/cmc/lib/session-state.ts';
import { blocked } from '../test-support/expect.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'plugins', 'cmc');
const SESSION = 'd0546eba-c080-415b-b5e2-863787cb5937';

let dataDir: string;
let dir: string;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'cmc-release-now-'));
  dir = sessionDir(dataDir, SESSION);
});
afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

const texts = () => listMessages(dir).messages.map((message) => message.text);
const hold = (...items: string[]) => items.forEach((text) => addMessage(dir, { text }));
const type = (prompt: string) => handlePrompt({ session_id: SESSION, prompt }, { dataDir });
const stop = (extra: { stop_hook_active?: boolean } = {}) => handleStop({ session_id: SESSION, ...extra }, { dataDir });
// A prompt that goes to the agent: from then on a turn is running.
const startTurn = () => assert.equal(type('do the task'), null);
const context = (output: PromptBlock | PromptContext | null) =>
  output !== null && 'hookSpecificOutput' in output ? output.hookSpecificOutput.additionalContext : undefined;
const cmc = (...args: string[]) =>
  spawnSync(process.execPath, [join(root, 'bin', 'cmc.ts'), ...args, '--data-dir', dataDir, '--session', SESSION], { encoding: 'utf8' });

describe('release now (";;now")', () => {
  it('lets the prompt through with the whole queue as context', () => {
    hold('one', 'two');
    assert.deepEqual(type(';;now'), {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: '[cmc] The user released their held messages with ";;now":\n1. one\n2. two',
      },
    });
    assert.deepEqual(texts(), []);
  });

  it('releases only the chosen positions, in queue order, and keeps the rest', () => {
    hold('a', 'b', 'c', 'd');
    assert.equal(context(type(';;now 3 1')), '[cmc] The user released their held messages with ";;now":\n1. a\n2. c');
    assert.deepEqual(texts(), ['b', 'd']);
  });

  it('blocks the prompt when nothing is held, so no empty turn starts', () => {
    assert.deepEqual(type(';;now'), { decision: 'block', reason: 'Nothing is held, so there is nothing to release.' });
  });

  it('explains a wrong position and releases nothing', () => {
    hold('a');
    assert.deepEqual(type(';;now 4'), { decision: 'block', reason: 'Not done: There is no held message 4 (the queue has 1).' });
    assert.deepEqual(texts(), ['a']);
  });

  it('delivers each message once', () => {
    hold('a');
    assert.ok(context(type(';;now')));
    assert.equal(blocked(type(';;now')).decision, 'block');
    assert.equal(stop(), null);
  });

  it('parses positions strictly', () => {
    assert.deepEqual(parseControl('now'), { name: 'now', positions: [] });
    assert.deepEqual(parseControl('end 2 3'), { name: 'end', positions: [2, 3] });
    assert.equal(parseControl('now please'), null);
    assert.equal(parseControl('end 0'), null);
  });
});

describe('";;now" while the agent is working', () => {
  it('waits for the end of the turn instead of handing the messages over mid-turn', () => {
    hold('one', 'two');
    startTurn();
    assert.deepEqual(type(';;now'), { decision: 'block', reason: 'The agent is working: 2 held message(s) will be released when this turn ends.' });
    assert.deepEqual(texts(), ['one', 'two'], 'nothing leaves the queue before the end of the turn');
    assert.equal(blocked(stop()).reason, '[cmc] The user released their held messages with ";;end":\n1. one\n2. two');
    assert.deepEqual(texts(), []);
  });

  it('waits only for the chosen messages', () => {
    hold('a', 'b', 'c');
    startTurn();
    assert.match(blocked(type(';;now 2')).reason, /^The agent is working: 1 held message\(s\) will be released/);
    assert.match(blocked(stop()).reason, /1\. b$/);
    assert.deepEqual(texts(), ['a', 'c']);
  });

  it('hands over at once again once the turn has ended', () => {
    hold('first');
    startTurn();
    assert.equal(stop(), null, 'nothing pending: the turn ends');
    assert.equal(readState(dir).turnActive, false);
    hold('second');
    assert.match(context(type(';;now')) ?? '', /1\. first\n2\. second$/);
  });

  it('keeps the turn running while cmc itself continues it', () => {
    hold('one');
    startTurn();
    type(';;end');
    assert.ok(stop(), 'cmc continues the turn with the messages');
    assert.equal(readState(dir).turnActive, true);
    assert.equal(stop({ stop_hook_active: true }), null);
    assert.equal(readState(dir).turnActive, false);
  });

  it('counts a ";;now" that went through as the start of a turn', () => {
    hold('one');
    assert.ok(context(type(';;now')));
    hold('two');
    assert.match(blocked(type(';;now')).reason, /^The agent is working/);
  });

  it('never blocks an ordinary prompt, even with a session id cmc cannot use', () => {
    assert.equal(handlePrompt({ session_id: '../escape', prompt: 'hello' }, { dataDir }), null);
  });
});

describe('selective release at the end of the turn (";;end N")', () => {
  it('delivers only the chosen messages when the turn ends', () => {
    hold('a', 'b', 'c');
    assert.equal(blocked(type(';;end 2')).reason, '1 held message(s) will be released when this turn ends.');
    assert.equal(blocked(stop()).reason, '[cmc] The user released their held message with ";;end":\n1. b');
    assert.deepEqual(texts(), ['a', 'c']);
    assert.equal(stop(), null, 'one-shot');
  });

  it('follows the messages, not the positions, when the queue is reordered afterwards', () => {
    hold('a', 'b', 'c');
    type(';;end 3');
    type(';;top 3');
    type(';;rm 2');
    assert.match(blocked(stop()).reason, /1\. c$/);
    assert.deepEqual(texts(), ['b']);
  });

  it('adds up several requests, and "everything" wins', () => {
    hold('a', 'b', 'c');
    type(';;end 1');
    type(';;end 3');
    const { atEnd } = readState(dir);
    assert.ok(Array.isArray(atEnd));
    assert.deepEqual(atEnd.length, 2);
    type(';;end');
    assert.equal(readState(dir).atEnd, 'all');
    assert.match(blocked(stop()).reason, /1\. a\n2\. b\n3\. c$/);
  });

  it('lets the turn end when the chosen message was deleted meanwhile', () => {
    hold('a', 'b');
    type(';;end 1');
    type(';;rm 1');
    assert.equal(stop(), null);
    assert.equal(readState(dir).atEnd, null);
    assert.deepEqual(texts(), ['b']);
  });
});

describe('release armed from outside the session (cmc release)', () => {
  it('hands the messages over when the agent\'s turn ends, once', () => {
    hold('a', 'b');
    assert.equal(cmc('release').stdout, "2 held message(s) will be released when the agent's turn ends.\n");
    assert.deepEqual(texts(), ['a', 'b'], 'nothing leaves the queue before then');
    assert.equal(blocked(stop()).reason, '[cmc] The user released their held messages with ";;end":\n1. a\n2. b');
    assert.equal(stop(), null);
    assert.deepEqual(texts(), []);
  });

  it('can release only some messages', () => {
    hold('a', 'b');
    assert.match(cmc('release', '2').stdout, /^1 held message\(s\) will be released/);
    assert.match(blocked(stop()).reason, /1\. b$/);
    assert.deepEqual(texts(), ['a']);
  });

  it('rejects bad usage and says when nothing is held', () => {
    assert.equal(cmc('release').stdout, 'Nothing is held, so there is nothing to release.\n');
    hold('a');
    for (const args of [['release', '--now'], ['release', '--end'], ['release', 'x'], ['release', '0']]) {
      assert.equal(cmc(...args).status, 1, args.join(' '));
    }
    assert.equal(cmc('release', '5').stdout, '[cmc] There is no held message 5 (the queue has 1).\n');
    assert.equal(readState(dir).atEnd, null);
  });
});

describe('mergeSelection', () => {
  it('combines selections', () => {
    assert.equal(mergeSelection(null, null), null);
    assert.deepEqual(mergeSelection(null, ['a']), ['a']);
    assert.deepEqual(mergeSelection(['a'], ['b', 'a']), ['a', 'b']);
    assert.equal(mergeSelection(['a'], 'all'), 'all');
    assert.equal(mergeSelection('all', ['a']), 'all');
  });
});
