// cmc — the user's settings: validation, defaults and their effect. Author: Peterson Sena (r3v3rs3).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findAgent, isAlive, listAgents } from '../plugins/cmc/lib/agents-registry.ts';
import { handlePrompt, type PromptBlock, type PromptContext } from '../plugins/cmc/lib/capture.ts';
import { DEFAULT_CONFIG, loadConfig, validateConfig, withPrefixes } from '../plugins/cmc/lib/config.ts';
import { sessionDir } from '../plugins/cmc/lib/paths.ts';
import { listMessages } from '../plugins/cmc/lib/queue.ts';
import { handleStop } from '../plugins/cmc/lib/release.ts';
import { handleSessionStart, listSessions } from '../plugins/cmc/lib/sessions.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fake = join(root, 'test-support', 'fake-claude.ts');
const SESSION = 'd0546eba-c080-415b-b5e2-863787cb5937';

let dataDir: string;
let dir: string;
beforeEach(() => {
  dataDir = realpathSync.native(mkdtempSync(join(tmpdir(), 'cmc-config-')));
  dir = sessionDir(dataDir, SESSION);
});
afterEach(async () => {
  const pids = listAgents(dir).flatMap((agent) => [agent.runnerPid, agent.pid]);
  for (let i = 0; i < 100 && pids.some(isAlive); i += 1) await new Promise<void>((resolve) => setTimeout(resolve, 50));
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const settings = (value: unknown) => writeFileSync(join(dataDir, 'config.json'), typeof value === 'string' ? value : JSON.stringify(value));
const type = (prompt: string) =>
  handlePrompt({ session_id: SESSION, prompt, cwd: tmpdir() }, { dataDir, claude: [process.execPath, fake], env: { ...process.env, FAKE_CLAUDE: 'ok' } });
function reply(output: PromptBlock | PromptContext | null): string {
  assert.ok(output !== null && 'decision' in output, `expected a blocked prompt, got ${JSON.stringify(output)}`);
  return output.reason;
}

describe('validateConfig', () => {
  it('takes every valid value', () => {
    const { config, warnings } = validateConfig({
      holdPrefix: '%%',
      dispatchPrefix: '=>',
      retentionDays: 0,
      dispatch: { context: 'pack', return: 'auto', permissionMode: 'plan', tools: ['Read', 'Bash(npm test:*)'] },
    });
    assert.deepEqual(warnings, []);
    assert.deepEqual(config, {
      holdPrefix: '%%',
      dispatchPrefix: '=>',
      retentionDays: 0,
      dispatch: { context: 'pack', return: 'auto', permissionMode: 'plan', tools: ['Read', 'Bash(npm test:*)'] },
    });
  });

  it('falls back to the default for each wrong value, and says which', () => {
    const { config, warnings } = validateConfig({
      holdPrefix: 'hold',
      dispatchPrefix: '/x',
      retentionDays: -1,
      dispatch: { context: 'clone', return: 'later', permissionMode: 'bypassPermissions', tools: ['Read', '--dangerously-skip-permissions'] },
    });
    assert.deepEqual(config, DEFAULT_CONFIG);
    assert.equal(warnings.length, 7);
    assert.match(warnings.join('\n'), /"holdPrefix" ignored: it must be 1 to 4 symbols/);
    assert.match(warnings.join('\n'), /"dispatch\.permissionMode" ignored: it must be one of "default", "acceptEdits", "plan"/);
    assert.match(warnings.join('\n'), /"dispatch\.tools" ignored/);
  });

  it('never lets an agent run with bypassPermissions', () => {
    for (const mode of ['bypassPermissions', 'dontAsk', 'BYPASSPERMISSIONS', '']) {
      assert.equal(validateConfig({ dispatch: { permissionMode: mode } }).config.dispatch.permissionMode, 'acceptEdits', mode);
    }
  });

  it('refuses prefixes that overlap', () => {
    const { config, warnings } = validateConfig({ holdPrefix: '>', dispatchPrefix: '>>' });
    assert.equal(config.holdPrefix, ';;');
    assert.equal(config.dispatchPrefix, '>>');
    assert.match(warnings[0] ?? '', /overlap/);
  });

  it('reports unknown settings instead of ignoring them silently', () => {
    const { warnings } = validateConfig({ holdprefix: '%%', dispatch: { tool: ['Read'] }, $schema: 'x' });
    assert.deepEqual(warnings, ['unknown setting "holdprefix" ignored', 'unknown setting "dispatch.tool" ignored']);
  });

  it('wants an object', () => {
    for (const value of [[], 'x', 3, null]) assert.match(validateConfig(value).warnings[0] ?? '', /must hold a JSON object/);
    assert.match(validateConfig({ dispatch: ['pack'] }).warnings[0] ?? '', /"dispatch" ignored: it must be an object/);
  });
});

describe('loadConfig', () => {
  it('uses the defaults without a file', () => {
    assert.deepEqual(loadConfig(dataDir), { config: DEFAULT_CONFIG, warnings: [], path: join(dataDir, 'config.json') });
  });

  it('uses the defaults and says why when the file is not JSON', () => {
    settings('{ "holdPrefix": ');
    const loaded = loadConfig(dataDir);
    assert.deepEqual(loaded.config, DEFAULT_CONFIG);
    assert.match(loaded.warnings[0] ?? '', /^config\.json ignored: it is not valid JSON/);
  });
});

describe('the settings in use', () => {
  it('changes the prefixes', () => {
    settings({ holdPrefix: '%%', dispatchPrefix: '=>' });
    assert.match(reply(type('%% later')), /^Held \(1 queued\)/);
    assert.equal(type(';; not a hold any more'), null);
    assert.deepEqual(listMessages(dir).messages.map((m) => m.text), ['later']);
    assert.match(reply(type('%%help')), /%%list {12}show the held messages[\s\S]*To dispatch a task to a second agent: "=> your task"/);
  });

  it('rewrites cmc\'s own hints for the prefixes in force, never what the user wrote', () => {
    const config = { ...DEFAULT_CONFIG, holdPrefix: '%%', dispatchPrefix: '=>' };
    assert.equal(withPrefixes('Type ";;list" or ">> task".', config), 'Type "%%list" or "=> task".');
    settings({ holdPrefix: '%%' });
    reply(type('%% keep ;; and >> as typed'));
    assert.match(reply(type('%%list')), /keep ;; and >> as typed$/);
  });

  it('names the hold prefix in what it releases', () => {
    settings({ holdPrefix: '%%' });
    type('%% one');
    type('do the task');
    type('%%end');
    assert.match(handleStop({ session_id: SESSION }, { dataDir })?.reason ?? '', /^\[cmc\] The user released their held message with "%%end":/);
  });

  it('sets how a dispatched agent starts by default, and the flags override it', async () => {
    settings({ dispatch: { context: 'pack', return: 'auto', permissionMode: 'plan', tools: ['Read', 'Grep'] } });
    reply(type('>> by default'));
    reply(type('>> --fork --held overridden'));
    const [byDefault, overridden] = listAgents(dir);
    assert.ok(byDefault !== undefined && overridden !== undefined);
    assert.deepEqual([byDefault.mode, byDefault.returnMode], ['pack', 'auto']);
    assert.deepEqual([overridden.mode, overridden.returnMode], ['fork', 'held']);
    const command = byDefault.command.join(' ');
    assert.match(command, /--permission-mode plan --allowedTools Read,Grep/);
    for (const agent of [byDefault, overridden]) {
      for (let i = 0; i < 100 && ['starting', 'running'].includes(findAgent(dir, agent.id).state); i += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
    }
  });

  it('sets how long inactive sessions are kept', () => {
    settings({ retentionDays: 1 });
    const old = 'b06d5f9a-57e8-44f3-8b37-b14b890259fc';
    handleSessionStart({ session_id: old, cwd: dataDir, source: 'startup' }, { dataDir });
    const record = join(sessionDir(dataDir, old), 'session.json');
    writeFileSync(record, JSON.stringify({ ...JSON.parse(readFileSync(record, 'utf8')), lastActiveAt: new Date(Date.now() - 2 * 86400000).toISOString() }));
    handleSessionStart({ session_id: SESSION, cwd: dataDir, source: 'startup' }, { dataDir });
    assert.deepEqual(listSessions([dataDir]).map((s) => s.id), [SESSION]);
  });

  it('reports bad settings when a session starts', () => {
    settings({ holdPrefix: 'abc' });
    const output = handleSessionStart({ session_id: SESSION, cwd: dataDir, source: 'startup' }, { dataDir });
    assert.match(output?.systemMessage ?? '', /^cmc settings \(config\.json\): "holdPrefix" ignored: it must be 1 to 4 symbols/);
  });
});

describe('cmc config', () => {
  const cmc = (...args: string[]) =>
    spawnSync(process.execPath, [join(root, 'plugins', 'cmc', 'bin', 'cmc.ts'), ...args, '--data-dir', dataDir], { encoding: 'utf8' });

  it('shows the defaults when there is no file, writes one on init, and will not overwrite it', () => {
    mkdirSync(dataDir, { recursive: true });
    assert.match(cmc('config').stdout, /^Settings file: .*config\.json \(not created; these are the defaults\)\n\{\n {2}"holdPrefix": ";;"/);
    const init = cmc('config', 'init');
    assert.equal(init.status, 0);
    assert.match(init.stdout, /^Wrote .*config\.json with every setting at its default/);
    assert.deepEqual(JSON.parse(readFileSync(join(dataDir, 'config.json'), 'utf8')), DEFAULT_CONFIG);
    const again = cmc('config', 'init');
    assert.equal(again.status, 1);
    assert.match(again.stdout, /already exists/);
  });

  it('keeps a broken file on init and lists its problems', () => {
    settings({ retentionDays: 'forever' });
    assert.equal(cmc('config', 'init').status, 1);
    assert.match(cmc('config').stdout, /Problems in config\.json:\n- "retentionDays" ignored/);
    assert.ok(existsSync(join(dataDir, 'config.json')));
  });

  it('rejects anything else', () => {
    assert.equal(cmc('config', 'set', 'x').status, 1);
  });
});
