// cmc — the queue outlives the session: resume, compaction, clean-up. Author: Peterson Sena (r3v3rs3).
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { handlePrompt } from '../plugins/cmc/lib/capture.ts';
import { sessionDir } from '../plugins/cmc/lib/paths.ts';
import { listMessages } from '../plugins/cmc/lib/queue.ts';
import { handleStop, releaseAll } from '../plugins/cmc/lib/release.ts';
import { handleSessionEnd, handleSessionStart, listSessions, pruneSessions } from '../plugins/cmc/lib/sessions.ts';
import { blocked, present } from '../test-support/expect.ts';

const SESSION = 'd0546eba-c080-415b-b5e2-863787cb5937';
const OLD = 'b06d5f9a-57e8-44f3-8b37-b14b890259fc';
const DAY = 24 * 60 * 60 * 1000;

let dataDir: string;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'cmc-persist-'));
});
afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

const start = (source: string, id = SESSION, options: { retentionDays?: number } = {}) =>
  handleSessionStart({ hook_event_name: 'SessionStart', session_id: id, cwd: dataDir, source }, { dataDir, ...options });
const type = (prompt: string, id = SESSION) => handlePrompt({ session_id: id, prompt }, { dataDir });
const held = (id = SESSION) => listMessages(sessionDir(dataDir, id)).messages.map((message) => message.text);

function age(id: string, days: number) {
  const file = join(sessionDir(dataDir, id), 'session.json');
  const record = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  writeFileSync(file, JSON.stringify({ ...record, lastActiveAt: new Date(Date.now() - days * DAY).toISOString() }));
}

describe('resuming a session', () => {
  it('finds the queue where it was left and reminds the user', () => {
    assert.equal(start('startup'), null, 'nothing to say on a fresh session');
    type(';; one');
    type(';; two');
    handleSessionEnd({ session_id: SESSION }, { dataDir });

    assert.deepEqual(start('resume'), {
      systemMessage: 'cmc: 2 held message(s) are waiting in this session. /held to send, edit or delete them (or ;;list).',
    });
    assert.deepEqual(held(), ['one', 'two']);
    assert.match(present(releaseAll(dataDir, SESSION, '/cmc:release').text), /1\. one\n2\. two$/);
  });

  it('keeps a pending ";;end" across the restart', () => {
    start('startup');
    type(';; one');
    type(';;end');
    handleSessionEnd({ session_id: SESSION }, { dataDir });
    start('resume');
    assert.match(blocked(handleStop({ session_id: SESSION }, { dataDir })).reason, /1\. one$/);
  });

  it('says nothing after a compaction and leaves the queue alone', () => {
    start('startup');
    type(';; one');
    assert.equal(start('compact'), null);
    assert.deepEqual(held(), ['one']);
  });
});

describe('cleaning up old sessions', () => {
  it('removes sessions inactive for longer than the retention, with their queue', () => {
    start('startup', OLD);
    type(';; forgotten', OLD);
    age(OLD, 31);
    start('startup');
    assert.equal(existsSync(join(dataDir, 'sessions', OLD)), false);
    assert.deepEqual(listSessions([dataDir]).map((record) => record.id), [SESSION]);
  });

  it('keeps sessions inside the retention and honours a custom number of days', () => {
    start('startup', OLD);
    type(';; still wanted', OLD);
    age(OLD, 10);
    start('startup');
    assert.deepEqual(held(OLD), ['still wanted']);
    start('startup', SESSION, { retentionDays: 7 });
    assert.equal(existsSync(join(dataDir, 'sessions', OLD)), false);
  });

  it('never removes the session that is starting, however old its record', () => {
    start('startup');
    type(';; mine');
    age(SESSION, 400);
    assert.deepEqual(pruneSessions(dataDir, { maxAgeDays: 30, keep: SESSION }), []);
    start('resume');
    assert.deepEqual(held(), ['mine']);
  });

  it('uses the age of the folder when a session has no record', () => {
    const orphan = join(dataDir, 'sessions', 'orphan-session');
    mkdirSync(orphan, { recursive: true });
    const old = new Date(Date.now() - 40 * DAY);
    utimesSync(orphan, old, old);
    assert.deepEqual(pruneSessions(dataDir, { maxAgeDays: 30 }), ['orphan-session']);
  });

  it('only ever touches session folders', () => {
    mkdirSync(join(dataDir, 'sessions'), { recursive: true });
    writeFileSync(join(dataDir, 'sessions', 'a-file'), '');
    mkdirSync(join(dataDir, 'sessions', 'not a session id'));
    const old = new Date(Date.now() - 400 * DAY);
    utimesSync(join(dataDir, 'sessions', 'not a session id'), old, old);
    assert.deepEqual(pruneSessions(dataDir, { maxAgeDays: 30 }), []);
    assert.deepEqual(pruneSessions(dataDir, { maxAgeDays: 0 }), [], 'retention 0 disables the clean-up');
    assert.ok(existsSync(join(dataDir, 'sessions', 'a-file')));
  });
});
