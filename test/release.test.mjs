// cmc — selective release, release "now" and release armed from the CLI. Author: Peterson Sena (r3v3rs3).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { handlePrompt } from '../lib/capture.mjs';
import { parseControl } from '../lib/control.mjs';
import { sessionDir } from '../lib/paths.mjs';
import { addMessage, listMessages } from '../lib/queue.mjs';
import { handlePostToolUse, handleStop } from '../lib/release.mjs';
import { mergeSelection, readState } from '../lib/session-state.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SESSION = 'd0546eba-c080-415b-b5e2-863787cb5937';

let dataDir;
let dir;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'cmc-release-now-'));
  dir = sessionDir(dataDir, SESSION);
});
afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

const texts = () => listMessages(dir).messages.map((message) => message.text);
const hold = (...items) => items.forEach((text) => addMessage(dir, { text }));
const type = (prompt) => handlePrompt({ session_id: SESSION, prompt }, { dataDir });
const stop = (extra = {}) => handleStop({ session_id: SESSION, ...extra }, { dataDir });
const afterTool = () => handlePostToolUse({ session_id: SESSION, tool_name: 'Bash' }, { dataDir });
const context = (output) => output?.hookSpecificOutput?.additionalContext;
const cmc = (...args) =>
  spawnSync(process.execPath, [join(root, 'bin', 'cmc.mjs'), ...args, '--data-dir', dataDir, '--session', SESSION], { encoding: 'utf8' });

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
    assert.equal(type(';;now').decision, 'block');
    assert.equal(stop(), null);
  });

  it('parses positions strictly', () => {
    assert.deepEqual(parseControl('now'), { name: 'now', positions: [] });
    assert.deepEqual(parseControl('end 2 3'), { name: 'end', positions: [2, 3] });
    assert.equal(parseControl('now please'), null);
    assert.equal(parseControl('end 0'), null);
  });
});

describe('selective release at the end of the turn (";;end N")', () => {
  it('delivers only the chosen messages when the turn ends', () => {
    hold('a', 'b', 'c');
    assert.equal(type(';;end 2').reason, '1 held message(s) will be released when this turn ends.');
    assert.equal(stop().reason, '[cmc] The user released their held message with ";;end":\n1. b');
    assert.deepEqual(texts(), ['a', 'c']);
    assert.equal(stop(), null, 'one-shot');
  });

  it('follows the messages, not the positions, when the queue is reordered afterwards', () => {
    hold('a', 'b', 'c');
    type(';;end 3');
    type(';;top 3');
    type(';;rm 2');
    assert.match(stop().reason, /1\. c$/);
    assert.deepEqual(texts(), ['b']);
  });

  it('adds up several requests, and "everything" wins', () => {
    hold('a', 'b', 'c');
    type(';;end 1');
    type(';;end 3');
    assert.deepEqual(readState(dir).atEnd.length, 2);
    type(';;end');
    assert.equal(readState(dir).atEnd, 'all');
    assert.match(stop().reason, /1\. a\n2\. b\n3\. c$/);
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
  it('delivers at the next tool call, once', () => {
    hold('a', 'b');
    assert.match(cmc('release').stdout, /^2 held message\(s\) will be released at the agent's next step/);
    assert.deepEqual(afterTool(), {
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: '[cmc] The user released their held messages with "cmc release --now":\n1. a\n2. b',
      },
    });
    assert.equal(afterTool(), null);
    assert.equal(stop(), null);
    assert.deepEqual(texts(), []);
  });

  it('falls back to the end of the turn when the agent takes no further step', () => {
    hold('a');
    cmc('release', '--now', '1');
    assert.equal(stop().reason, '[cmc] The user released their held message with "cmc release --now":\n1. a');
    assert.equal(afterTool(), null);
  });

  it('can arm the end of the turn instead', () => {
    hold('a', 'b');
    assert.match(cmc('release', '--end', '2').stdout, /^1 held message\(s\) will be released when the agent's turn ends\./);
    assert.equal(afterTool(), null, 'nothing mid-turn');
    assert.match(stop().reason, /with ";;end":\n1\. b$/);
  });

  it('does nothing on tool calls when no release is pending', () => {
    hold('a');
    assert.equal(afterTool(), null);
    assert.deepEqual(texts(), ['a']);
  });

  it('rejects bad usage and says when nothing is held', () => {
    assert.equal(cmc('release').stdout, 'Nothing is held, so there is nothing to release.\n');
    hold('a');
    for (const args of [['release', '--now', '--end'], ['release', 'x'], ['release', '0']]) {
      assert.equal(cmc(...args).status, 1, args.join(' '));
    }
    assert.equal(cmc('release', '5').stdout, '[cmc] There is no held message 5 (the queue has 1).\n');
    assert.equal(readState(dir).atNextStep, null);
  });
});

describe('tool-release hook script', () => {
  it('prints the context for a pending release and nothing otherwise', () => {
    const run = () =>
      spawnSync(process.execPath, [join(root, 'hooks', 'tool-release.mjs')], {
        input: JSON.stringify({ session_id: SESSION, tool_name: 'Bash' }),
        encoding: 'utf8',
        env: { ...process.env, CLAUDE_PLUGIN_DATA: dataDir },
      });
    hold('a');
    assert.equal(run().stdout, '');
    cmc('release');
    assert.match(JSON.parse(run().stdout).hookSpecificOutput.additionalContext, /1\. a$/);
    assert.equal(run().stdout, '');
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
