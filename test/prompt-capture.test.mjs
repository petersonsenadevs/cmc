// cmc — prompt capture. Author: Peterson Sena (r3v3rs3).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { handlePrompt } from '../plugins/cmc/lib/capture.mjs';
import { sessionDir } from '../plugins/cmc/lib/paths.mjs';
import { listMessages, MAX_TEXT_LENGTH } from '../plugins/cmc/lib/queue.mjs';

const hook = join(dirname(fileURLToPath(import.meta.url)), '..', 'plugins', 'cmc', 'hooks', 'prompt-capture.mjs');
const SESSION = 'd0546eba-c080-415b-b5e2-863787cb5937';

let dataDir;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'cmc-capture-'));
});
afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

const held = () => listMessages(sessionDir(dataDir, SESSION)).messages.map((message) => message.text);
const submit = (prompt) => handlePrompt({ hook_event_name: 'UserPromptSubmit', session_id: SESSION, prompt }, { dataDir });

function runHookScript(stdin, env = { CLAUDE_PLUGIN_DATA: dataDir }) {
  return spawnSync(process.execPath, [hook], { input: stdin, encoding: 'utf8', env: { ...process.env, ...env } });
}

describe('handlePrompt', () => {
  it('lets a prompt without the prefix through untouched', () => {
    assert.equal(submit('fix the failing test'), null);
    assert.equal(submit(' ;; not at the very start'), null);
    assert.equal(submit('/cmc:release'), null);
    assert.equal(existsSync(join(dataDir, 'sessions')), false, 'nothing is written for ordinary prompts');
  });

  it('holds a prefixed prompt and blocks it with a short receipt', () => {
    assert.deepEqual(submit(';; also update the README'), {
      decision: 'block',
      reason: 'Held (1 queued). Release with /cmc:release.',
    });
    assert.equal(submit(';;second, no space').reason, 'Held (2 queued). Release with /cmc:release.');
    assert.deepEqual(held(), ['also update the README', 'second, no space']);
  });

  it('keeps multi-line messages whole', () => {
    submit(';; first line\nsecond line');
    assert.deepEqual(held(), ['first line\nsecond line']);
  });

  it('blocks a bare prefix with a hint and holds nothing', () => {
    assert.match(submit(';;   ').reason, /^Nothing to hold\./);
    assert.deepEqual(held(), []);
  });

  it('refuses a message that is too long and says why', () => {
    assert.match(submit(`;;${'x'.repeat(MAX_TEXT_LENGTH + 1)}`).reason, /^Not done: A held message can be at most/);
    assert.deepEqual(held(), []);
  });

  it('uses a custom prefix when given one', () => {
    const output = handlePrompt({ session_id: SESSION, prompt: 'hold: later' }, { dataDir, prefix: 'hold:' });
    assert.equal(output.decision, 'block');
    assert.equal(handlePrompt({ session_id: SESSION, prompt: ';; not held now' }, { dataDir, prefix: 'hold:' }), null);
    assert.deepEqual(held(), ['later']);
  });

  it('ignores input without a string prompt', () => {
    assert.equal(handlePrompt({ session_id: SESSION }, { dataDir }), null);
    assert.equal(handlePrompt({ session_id: SESSION, prompt: 42 }, { dataDir }), null);
  });
});

describe('prompt-capture hook script', () => {
  it('prints the block decision for a held prompt', () => {
    const result = runHookScript(JSON.stringify({ session_id: SESSION, prompt: ';; from the hook' }));
    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(result.stdout), { decision: 'block', reason: 'Held (1 queued). Release with /cmc:release.' });
    assert.deepEqual(held(), ['from the hook']);
  });

  it('prints nothing for an ordinary prompt', () => {
    const result = runHookScript(JSON.stringify({ session_id: SESSION, prompt: 'hello' }));
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  });

  it('lets the prompt through and logs when its input is not JSON', () => {
    const result = runHookScript('not json');
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.match(readFileSync(join(dataDir, 'cmc.log'), 'utf8'), /"event":"prompt-capture failed"/);
  });

  it('lets the prompt through when the session id cannot be used', () => {
    const result = runHookScript(JSON.stringify({ session_id: '../escape', prompt: ';; text' }));
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.match(readFileSync(join(dataDir, 'cmc.log'), 'utf8'), /BAD_SESSION_ID/);
  });

  it('lets the prompt through when the data directory is unusable', () => {
    const file = join(dataDir, 'a-file');
    writeFileSync(file, '');
    const result = runHookScript(JSON.stringify({ session_id: SESSION, prompt: ';; text' }), { CLAUDE_PLUGIN_DATA: file });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /prompt-capture failed/);
  });

  it('never writes the message text to the log', () => {
    runHookScript(JSON.stringify({ session_id: '../escape', prompt: ';; SECRET-TEXT' }));
    assert.doesNotMatch(readFileSync(join(dataDir, 'cmc.log'), 'utf8'), /SECRET-TEXT/);
  });
});
