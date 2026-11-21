// cmc — the model and the effort of subagents: settings, command line, flags and the panel. Author: Peterson Sena (r3v3rs3).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { parseAgentControl, parseDispatch } from '../plugins/cmc/lib/agent-control.ts';
import { DEFAULT_CONFIG, setMode, validateConfig } from '../plugins/cmc/lib/config.ts';
import { buildCommand, DEFAULT_TOOLS, type BuildCommandOptions } from '../plugins/cmc/lib/dispatch.ts';
import { modelAndEffort, pickerLabel, PICKERS, readModes } from '../plugins/cmc/hooks/panel.ts';

const SESSION = 'd0546eba-c080-415b-b5e2-863787cb5937';
const ROOT = resolve('plugins/cmc');
const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

describe('settings', () => {
  it('default to inherit: the user\'s own Claude Code setup decides', () => {
    assert.equal(DEFAULT_CONFIG.dispatch.model, 'inherit');
    assert.equal(DEFAULT_CONFIG.dispatch.effort, 'inherit');
  });

  it('take an alias or a full model name, and an effort Claude Code knows; anything else falls back with a warning', () => {
    assert.equal(validateConfig({ dispatch: { model: 'sonnet', effort: 'low' } }).config.dispatch.model, 'sonnet');
    assert.equal(validateConfig({ dispatch: { model: 'claude-opus-5-5' } }).config.dispatch.model, 'claude-opus-5-5');
    assert.equal(validateConfig({ dispatch: { effort: 'xhigh' } }).config.dispatch.effort, 'xhigh');
    for (const bad of [{ model: 'son net' }, { model: '--danger' }, { model: 3 }, { effort: 'extreme' }]) {
      const { config, warnings } = validateConfig({ dispatch: bad });
      assert.equal(config.dispatch.model, 'inherit', JSON.stringify(bad));
      assert.equal(config.dispatch.effort, 'inherit', JSON.stringify(bad));
      assert.equal(warnings.length, 1, JSON.stringify(bad));
    }
  });

  it('are modes the panel switches', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmc-model-'));
    made.push(dir);
    setMode(dir, 'dispatch.model', 'haiku');
    setMode(dir, 'dispatch.effort', 'max');
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')), { dispatch: { model: 'haiku', effort: 'max' } });
    assert.throws(() => setMode(dir, 'dispatch.effort', 'extreme'), /takes/);
  });
});

describe('the command line of a subagent', () => {
  const base: BuildCommandOptions = { claude: ['claude'], mode: 'fork', sessionId: SESSION, worktree: null, permissionMode: 'acceptEdits', tools: DEFAULT_TOOLS };
  const tail = (command: string[]) => command.slice(command.indexOf('--allowedTools') + 2);

  it('carries --model and --effort only when chosen', () => {
    assert.deepEqual(tail(buildCommand(base)), ['--resume', SESSION, '--fork-session']);
    assert.deepEqual(tail(buildCommand({ ...base, model: 'inherit', effort: 'inherit' })), ['--resume', SESSION, '--fork-session']);
    assert.deepEqual(tail(buildCommand({ ...base, model: 'sonnet', effort: 'low' })), ['--model', 'sonnet', '--effort', 'low', '--resume', SESSION, '--fork-session']);
  });

  it('refuses a model or an effort that could be read as something else', () => {
    assert.throws(() => buildCommand({ ...base, model: '--dangerously-skip-permissions' }), { code: 'BAD_MODEL' });
    assert.throws(() => buildCommand({ ...base, effort: 'extreme' }), { code: 'BAD_EFFORT' });
  });
});

describe('choosing for one task', () => {
  it('">> --model sonnet --effort low task" and the "=" form', () => {
    assert.deepEqual(parseDispatch('--model sonnet --effort low fix the tests'), { task: 'fix the tests', mode: 'fork', returnMode: 'held', model: 'sonnet', effort: 'low' });
    assert.deepEqual(parseDispatch('--pack --model=haiku summarise'), { task: 'summarise', mode: 'pack', returnMode: 'held', model: 'haiku' });
    assert.deepEqual(parseDispatch('fix the tests'), { task: 'fix the tests', mode: 'fork', returnMode: 'held' });
    assert.throws(() => parseDispatch('--effort extreme fix it'), /not an effort/);
  });

  it('";;dispatch 2 --model opus --effort high"', () => {
    assert.deepEqual(parseAgentControl('dispatch 2 --model opus --effort high'), { name: 'dispatch', position: 2, mode: 'fork', returnMode: 'held', model: 'opus', effort: 'high' });
    assert.equal(parseAgentControl('dispatch 2 --model'), null);
    assert.equal(parseAgentControl('dispatch 2 --effort extreme'), null);
  });

  it('cmc dispatch refuses a bad --model or --effort before starting anything', () => {
    const data = mkdtempSync(join(tmpdir(), 'cmc-model-cli-'));
    made.push(data);
    const run = (...args: string[]) =>
      spawnSync('node', [join(ROOT, 'bin/cmc.ts'), 'dispatch', ...args, '--data-dir', data, '--session', SESSION], { encoding: 'utf8', cwd: tmpdir() });
    assert.match(run('--effort', 'extreme', 'task').stdout, /"extreme" is not an effort/);
    assert.match(run('--model', 'a b', 'task').stdout, /is not a model name/);
  });
});

describe('the panel', () => {
  it('reads the model and effort from the settings, and offers aliases and efforts', () => {
    assert.equal(readModes('{"dispatch":{"model":"sonnet","effort":"low"}}')['dispatch.model'], 'sonnet');
    assert.equal(readModes('')['dispatch.effort'], 'inherit');
    assert.deepEqual(PICKERS.map((picker) => picker.key), ['dispatch.model', 'dispatch.effort']);
    assert.equal(pickerLabel('inherit'), 'Same as mine');
  });

  it('shows on each subagent the model and effort it works with', () => {
    assert.equal(modelAndEffort('inherit', 'inherit'), '');
    assert.equal(modelAndEffort('sonnet', 'inherit'), ' · sonnet');
    assert.equal(modelAndEffort('haiku', 'low'), ' · haiku · effort low');
    assert.equal(modelAndEffort(undefined, undefined), '');
  });

  it('keeps a full model name from the settings selectable', () => {
    assert.equal(readModes('{"dispatch":{"model":"claude-sonnet-5-5"}}')['dispatch.model'], 'claude-sonnet-5-5');
  });
});
