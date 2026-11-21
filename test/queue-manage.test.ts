// cmc — managing the queue: view, edit, delete, reorder. Author: Peterson Sena (r3v3rs3).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { handlePrompt } from '../plugins/cmc/lib/capture.ts';
import { parseControl } from '../plugins/cmc/lib/control.ts';
import { sessionDir } from '../plugins/cmc/lib/paths.ts';
import { addMessage, clearMessages, editMessage, listMessages, moveMessage, removeMessages } from '../plugins/cmc/lib/queue.ts';
import { formatQueue } from '../plugins/cmc/lib/queue-view.ts';
import { releaseAll } from '../plugins/cmc/lib/release.ts';
import { blocked, first, present } from '../test-support/expect.ts';

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'plugins', 'cmc', 'bin', 'cmc.ts');
const SESSION = 'd0546eba-c080-415b-b5e2-863787cb5937';

let dataDir: string;
let dir: string;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'cmc-manage-'));
  dir = sessionDir(dataDir, SESSION);
});
afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

const texts = () => listMessages(dir).messages.map((message) => message.text);
const hold = (...items: string[]) => items.forEach((text) => addMessage(dir, { text }));
const type = (prompt: string) => handlePrompt({ session_id: SESSION, prompt }, { dataDir });
const cmc = (...args: string[]) => spawnSync(process.execPath, [cli, ...args, '--data-dir', dataDir, '--session', SESSION], { encoding: 'utf8' });

describe('queue management in the core', () => {
  it('edits the text of one message and keeps its id, time and place', () => {
    hold('one', 'two', 'three');
    const before = listMessages(dir).messages[1];
    editMessage(dir, 2, '  two, corrected ');
    const after = listMessages(dir).messages[1];
    assert.deepEqual(after, { ...before, text: 'two, corrected' });
    assert.deepEqual(texts(), ['one', 'two, corrected', 'three']);
  });

  it('rejects an empty or oversized edit and leaves the message alone', () => {
    hold('one');
    assert.throws(() => editMessage(dir, 1, '  '), { code: 'EMPTY_MESSAGE' });
    assert.throws(() => editMessage(dir, 1, 'x'.repeat(20001)), { code: 'MESSAGE_TOO_LONG' });
    assert.deepEqual(texts(), ['one']);
  });

  it('deletes several positions at once', () => {
    hold('one', 'two', 'three', 'four');
    const result = removeMessages(dir, [4, 2]);
    assert.deepEqual(result.removed.map((message) => message.text), ['two', 'four']);
    assert.deepEqual(texts(), ['one', 'three']);
  });

  it('deletes nothing when one of the positions does not exist', () => {
    hold('one', 'two');
    assert.throws(() => removeMessages(dir, [1, 5]), { code: 'NO_SUCH_MESSAGE', message: 'There is no held message 5 (the queue has 2).' });
    assert.deepEqual(texts(), ['one', 'two']);
  });

  it('clears the queue', () => {
    hold('one', 'two');
    assert.equal(clearMessages(dir).removed.length, 2);
    assert.deepEqual(texts(), []);
    assert.equal(clearMessages(dir).removed.length, 0);
  });

  it('moves a message to any position, both ways', () => {
    hold('a', 'b', 'c', 'd');
    moveMessage(dir, 4, 1);
    assert.deepEqual(texts(), ['d', 'a', 'b', 'c']);
    moveMessage(dir, 1, 3);
    assert.deepEqual(texts(), ['a', 'b', 'd', 'c']);
    moveMessage(dir, 2, 2);
    assert.deepEqual(texts(), ['a', 'b', 'd', 'c']);
  });

  it('refuses positions outside the queue', () => {
    hold('a', 'b');
    const outside: [number, number][] = [[0, 1], [3, 1], [1, 3], [1.5, 1], [-1, 1]];
    for (const [from, to] of outside) {
      assert.throws(() => moveMessage(dir, from, to), { code: 'NO_SUCH_MESSAGE' });
    }
    assert.throws(() => moveMessage(sessionDir(dataDir, 'empty'), 1, 1), {
      message: 'There is no held message 1 (nothing is held).',
    });
  });

  it('releases in exactly the order the list shows', () => {
    hold('first written', 'second written', 'third written');
    moveMessage(dir, 3, 1);
    const listed = formatQueue(listMessages(dir).messages);
    assert.match(listed, /1\. .*third written\n2\. .*first written\n3\. .*second written$/);
    assert.match(present(releaseAll(dataDir, SESSION, '/cmc:release').text), /1\. third written\n2\. first written\n3\. second written$/);
  });
});

describe('formatQueue', () => {
  it('shows position, time, id and text', () => {
    hold('rename the flag');
    const message = first(listMessages(dir).messages);
    assert.match(formatQueue([message]), new RegExp(`^1 held message, in delivery order:\\n1\\. \\[\\d\\d:\\d\\d · ${message.id}\\] rename the flag$`));
  });

  it('flattens and shortens long text, and marks messages that did not come from the user', () => {
    const long = { id: 'abc12345', at: '2026-11-21T10:00:00.000Z', source: 'agent 7f3a', text: `line one\nline two ${'x'.repeat(300)}` };
    const [, line] = formatQueue([long]).split('\n');
    assert.ok(line !== undefined);
    assert.match(line, /\(from agent 7f3a\) line one line two x+…$/);
    assert.ok(line.length < 220);
  });

  it('says when nothing is held', () => {
    assert.equal(formatQueue([]), 'No messages are held.');
  });
});

describe('control words', () => {
  it('recognises only the exact grammar', () => {
    assert.deepEqual(parseControl('list'), { name: 'list' });
    assert.deepEqual(parseControl('rm 2 3'), { name: 'rm', positions: [2, 3] });
    assert.deepEqual(parseControl('move 3 1'), { name: 'move', positions: [3, 1] });
    assert.deepEqual(parseControl('top 4'), { name: 'top', positions: [4] });
    assert.deepEqual(parseControl('edit 2 new text\nwith a second line'), {
      name: 'edit',
      positions: [2],
      text: 'new text\nwith a second line',
    });
    for (const notControl of [' list', 'list the files', 'rm', 'rm two', 'rm 0', 'move 1', 'move 1 2 3', 'edit 2', 'edit two x', 'up', 'ending', 'LIST']) {
      assert.equal(parseControl(notControl), null, notControl);
    }
  });

  it('holds text that merely starts like a control word', () => {
    type(';;list the files in src');
    type(';; clear');
    assert.deepEqual(texts(), ['list the files in src', 'clear']);
  });

  it('shows the queue without releasing anything', () => {
    hold('one', 'two');
    const output = type(';;list');
    assert.equal(blocked(output).decision, 'block');
    assert.match(blocked(output).reason, /^2 held messages, in delivery order:\n1\. .* one\n2\. .* two$/);
    assert.deepEqual(texts(), ['one', 'two']);
  });

  it('edits, deletes and reorders, answering with the new list', () => {
    hold('a', 'b', 'c');
    assert.match(blocked(type(';;edit 2 b, fixed')).reason, /^Message 2 updated\.\n3 held messages/);
    assert.match(blocked(type(';;top 3')).reason, /^Message 3 is now first\.\n/);
    assert.deepEqual(texts(), ['c', 'a', 'b, fixed']);
    type(';;down 1');
    assert.deepEqual(texts(), ['a', 'c', 'b, fixed']);
    type(';;up 3');
    assert.deepEqual(texts(), ['a', 'b, fixed', 'c']);
    type(';;bottom 1');
    assert.deepEqual(texts(), ['b, fixed', 'c', 'a']);
    type(';;move 3 2');
    assert.deepEqual(texts(), ['b, fixed', 'a', 'c']);
    assert.match(blocked(type(';;rm 1 3')).reason, /^Deleted 2 held message\(s\)\.\n1 held message/);
    assert.deepEqual(texts(), ['a']);
    assert.equal(blocked(type(';;clear')).reason, 'Deleted 1 held message(s). The queue is empty.');
    assert.deepEqual(texts(), []);
  });

  it('stays put at the edges', () => {
    hold('a', 'b');
    type(';;up 1');
    type(';;down 2');
    assert.deepEqual(texts(), ['a', 'b']);
  });

  it('explains a wrong position instead of failing', () => {
    hold('a');
    assert.deepEqual(type(';;rm 7'), { decision: 'block', reason: 'Not done: There is no held message 7 (the queue has 1).' });
    assert.deepEqual(texts(), ['a']);
  });

  it('prints help', () => {
    assert.match(blocked(type(';;help')).reason, /^cmc control words/);
  });
});

describe('cmc CLI queue commands', () => {
  it('lists, edits, moves and deletes', () => {
    hold('a', 'b', 'c');
    assert.match(cmc('list').stdout, /^3 held messages, in delivery order:/);
    assert.match(cmc('edit', '2', 'b with spaces', 'and more').stdout, /^Message 2 updated\./);
    cmc('move', '3', '1');
    assert.deepEqual(texts(), ['c', 'a', 'b with spaces and more']);
    cmc('rm', '1');
    cmc('top', '2');
    assert.deepEqual(texts(), ['b with spaces and more', 'a']);
    assert.match(cmc('clear').stdout, /^Deleted 2 held message/);
  });

  it('fails with a readable message on wrong arguments or positions', () => {
    hold('a');
    for (const args of [['move', '1'], ['edit', '1'], ['rm'], ['rm', 'x'], ['list', 'extra']]) {
      const result = cmc(...args);
      assert.equal(result.status, 1, args.join(' '));
      assert.match(result.stdout, /^\[cmc\] Wrong arguments/);
    }
    const missing = cmc('rm', '9');
    assert.equal(missing.status, 1);
    assert.equal(missing.stdout, '[cmc] There is no held message 9 (the queue has 1).\n');
  });
});
