// cmc — interactive interface (hooks module): hold on Enter, /held and /send. Author: Peterson Sena (r3v3rs3).
// The stand-in engine runs the real cmc command line, so the module is tested
// against the same core, lock and files as everywhere else.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import {
  COMMANDS,
  holdPrefixFrom,
  messageToHold,
  positionsFrom,
  register,
  startInterface,
  type CommandRunEvent,
  type InterfaceEngine,
  type PromptSubmitEvent,
} from '../plugins/cmc/hooks/interface.ts';
import { register as registerModule } from '../plugins/cmc/hooks/module.ts';
import { sessionDir } from '../plugins/cmc/lib/paths.ts';
import { listMessages } from '../plugins/cmc/lib/queue.ts';
import { readState, updateState } from '../plugins/cmc/lib/session-state.ts';
import { sendMessages, takeMessages } from '../plugins/cmc/lib/release.ts';
import { addMessage } from '../plugins/cmc/lib/queue.ts';
import { present } from '../test-support/expect.ts';

const ROOT = resolve('plugins/cmc');
const SESSION = '5b1f3c2e-9a7d-4e61-8c0b-2f4d6e8a1b3c';
const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function dataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cmc-interface-'));
  made.push(dir);
  return dir;
}

type Hooks = {
  submit?: ($: InterfaceEngine, e: PromptSubmitEvent, next: (e: PromptSubmitEvent) => Promise<unknown>) => Promise<unknown>;
  command?: ($: InterfaceEngine, e: CommandRunEvent, next: (e: CommandRunEvent) => Promise<unknown>) => Promise<unknown>;
};

/** A `$` whose `process.run` runs the real command, plus a record of what the module did to the screen. */
function engine(data: string, box = '') {
  const submitted: string[] = [];
  const filled: string[] = [];
  const registered: string[] = [];
  const state = { box };
  const $: InterfaceEngine = {
    session: { id: async () => SESSION },
    plugin: { root: ROOT },
    process: {
      hookEnv: async () => ({ CLAUDE_PLUGIN_DATA: data }),
      run: async (argv, init) => {
        const [command, ...args] = argv;
        const run = spawnSync(present(command), args, { input: init?.stdin ?? '', encoding: 'utf8', cwd: tmpdir() });
        return { exitCode: run.status ?? 1, stdout: run.stdout, stderr: run.stderr };
      },
    },
    fs: {
      read: async () => {
        throw new Error('no settings file');
      },
    },
    clock: { sleep: async () => undefined },
    prompt: {
      read: async () => ({ text: state.box, cursor: state.box.length }),
      fill: async ({ text }) => {
        filled.push(text);
        state.box = text;
      },
      submit: async ({ text }) => {
        submitted.push(text);
      },
    },
    command: {
      register: async ({ name }) => {
        registered.push(name);
      },
    },
  };
  return { $, submitted, filled, registered, state };
}

async function started(world: ReturnType<typeof engine>): Promise<Required<Hooks>> {
  const hooks: Hooks = {};
  register(((event: string, handler: never) => {
    if (event === 'prompt.submit') hooks.submit = handler;
    if (event === 'command.run') hooks.command = handler;
  }) as never);
  await startInterface(world.$);
  return { submit: present(hooks.submit), command: present(hooks.command) };
}

const passed = async <E>(e: E) => ({ passed: e });
const settle = () => new Promise((done) => setImmediate(done));

describe('interface: what counts as a message to hold', () => {
  it('holds the prefix followed by a space, and leaves control words and lone prefixes to the command hooks', () => {
    assert.equal(messageToHold(';; also say mango', ';;'), 'also say mango');
    assert.equal(messageToHold(';;\nline one\nline two', ';;'), 'line one\nline two');
    assert.equal(messageToHold(';;list', ';;'), null);
    assert.equal(messageToHold(';;', ';;'), null);
    assert.equal(messageToHold(';;   ', ';;'), null);
    assert.equal(messageToHold('fix the bug ;; now', ';;'), null);
    assert.equal(messageToHold('>> do this', '>>'), 'do this');
  });

  it('takes the hold prefix from the settings only when it is a valid one', () => {
    assert.equal(holdPrefixFrom(null), ';;');
    assert.equal(holdPrefixFrom('{"holdPrefix":"!!"}'), '!!');
    assert.equal(holdPrefixFrom('{"holdPrefix":"ab"}'), ';;');
    assert.equal(holdPrefixFrom('{"holdPrefix":"/x"}'), ';;');
    assert.equal(holdPrefixFrom('not json'), ';;');
  });

  it('reads positions for /send, and refuses anything else', () => {
    assert.deepEqual(positionsFrom(''), []);
    assert.deepEqual(positionsFrom(' 2  3 '), ['2', '3']);
    assert.equal(positionsFrom('all'), null);
    assert.equal(positionsFrom('0'), null);
    assert.equal(positionsFrom('2; rm'), null);
  });
});

describe('interface: in a session', () => {
  it('registers /held and /send as commands that run at once', async () => {
    const world = engine(dataDir());
    await started(world);
    assert.deepEqual(world.registered, ['held', 'send']);
    assert.ok(COMMANDS.every((spec) => spec.immediate === true));
  });

  it('holds a message on Enter, keeps it out of the conversation and empties the box', async () => {
    const data = dataDir();
    const world = engine(data, ';; also say mango');
    const { submit } = await started(world);
    const answer = await submit(world.$, { text: ';; also say mango' }, passed);
    assert.deepEqual(answer, { drop: 'cmc: held (1). /held shows them, /send sends them.' });
    await settle();
    assert.deepEqual(world.filled, ['']);
    const { messages } = listMessages(sessionDir(data, SESSION));
    assert.deepEqual(messages.map((message) => message.text), ['also say mango']);
  });

  it('keeps a multi-line message whole, quotes and all', async () => {
    const data = dataDir();
    const world = engine(data);
    const { submit } = await started(world);
    await submit(world.$, { text: ';; first line\nsecond "line" with $HOME' }, passed);
    const { messages } = listMessages(sessionDir(data, SESSION));
    assert.equal(messages[0]?.text, 'first line\nsecond "line" with $HOME');
  });

  it('does not empty the box when the person already typed something else', async () => {
    const world = engine(dataDir(), 'the next thing I am typing');
    const { submit } = await started(world);
    await submit(world.$, { text: ';; held one' }, passed);
    await settle();
    assert.deepEqual(world.filled, []);
  });

  it('lets everything else through untouched: prompts, control words, commands and prompts the person did not type', async () => {
    const data = dataDir();
    const world = engine(data);
    const { submit } = await started(world);
    for (const e of [{ text: 'fix the bug' }, { text: ';;list' }, { text: ';; x', command: {} }, { text: ';; x', isMeta: true as const }]) {
      assert.deepEqual(await submit(world.$, e, passed), { passed: e });
    }
    assert.deepEqual(listMessages(sessionDir(data, SESSION)).messages, []);
  });

  it('hands the prompt on when the command line fails, so the command hooks still hold it', async () => {
    const world = engine(dataDir());
    const { submit } = await started(world);
    world.$.process.run = async () => ({ exitCode: 1, stdout: '', stderr: 'broken' });
    const e = { text: ';; keep me' };
    assert.deepEqual(await submit(world.$, e, passed), { passed: e });
  });

  it('/held lists the held messages for the person only', async () => {
    const data = dataDir();
    const world = engine(data);
    const { submit, command } = await started(world);
    await submit(world.$, { text: ';; one' }, passed);
    await submit(world.$, { text: ';; two' }, passed);
    const answer = (await command(world.$, { command: 'held', args: '' }, passed)) as { text: string; isTextDisplayOnly: true };
    assert.equal(answer.isTextDisplayOnly, true);
    assert.match(answer.text, /1\. .*one\n2\. .*two/);
  });

  it('/send with the agent idle submits the messages as a new prompt at once', async () => {
    const data = dataDir();
    const world = engine(data);
    const { submit, command } = await started(world);
    await submit(world.$, { text: ';; one' }, passed);
    await submit(world.$, { text: ';; two' }, passed);
    const answer = await command(world.$, { command: 'send', args: '2' }, passed);
    assert.deepEqual(answer, { text: '1 held message(s) sent.', isTextDisplayOnly: true });
    assert.deepEqual(world.submitted, ['[cmc] The user released their held message with "/send":\n1. two']);
    assert.deepEqual(listMessages(sessionDir(data, SESSION)).messages.map((message) => message.text), ['one']);
  });

  it('/send keeps the messages held when the engine refuses the prompt (as it does headless)', async () => {
    const data = dataDir();
    const world = engine(data);
    const { submit, command } = await started(world);
    await submit(world.$, { text: ';; mango' }, passed);
    world.$.prompt.submit = async () => {
      throw new Error('no prompt box');
    };
    const answer = (await command(world.$, { command: 'send', args: '' }, passed)) as { text: string };
    assert.match(answer.text, /could not send.*still held/i);
    assert.deepEqual(listMessages(sessionDir(data, SESSION)).messages.map((message) => message.text), ['mango']);
  });

  it('/send keeps the messages held when a hook drops the prompt', async () => {
    const data = dataDir();
    const world = engine(data);
    const { submit, command } = await started(world);
    await submit(world.$, { text: ';; mango' }, passed);
    world.$.prompt.submit = async () => ({ drop: 'blocked by policy' });
    await command(world.$, { command: 'send', args: '' }, passed);
    assert.deepEqual(listMessages(sessionDir(data, SESSION)).messages.map((message) => message.text), ['mango']);
  });

  it('/send while the agent works waits for the end of its turn and submits nothing', async () => {
    const data = dataDir();
    const world = engine(data);
    const { submit, command } = await started(world);
    await submit(world.$, { text: ';; one' }, passed);
    updateState(sessionDir(data, SESSION), { turnActive: true });
    const answer = await command(world.$, { command: 'send', args: '' }, passed);
    assert.deepEqual(answer, { text: 'The agent is working; 1 held message(s) will be sent when its turn ends.', isTextDisplayOnly: true });
    assert.deepEqual(world.submitted, []);
    assert.equal(readState(sessionDir(data, SESSION)).atEnd, 'all');
  });

  it('/send answers plainly when nothing is held or the arguments are wrong, and other commands pass', async () => {
    const world = engine(dataDir());
    const { command } = await started(world);
    assert.deepEqual(await command(world.$, { command: 'send', args: '' }, passed), { text: 'Nothing is held.', isTextDisplayOnly: true });
    assert.deepEqual(await command(world.$, { command: 'send', args: 'everything' }, passed), {
      text: 'Usage: /send, or /send 2 3 for some of the held messages.',
      isTextDisplayOnly: true,
    });
    const other = { command: 'compact', args: '' };
    assert.deepEqual(await command(world.$, other, passed), { passed: other });
  });
});

describe('sendMessages (core)', () => {
  it('hands over now when idle, arms the end of the turn while working, and does nothing when empty', () => {
    const dir = sessionDir(dataDir(), SESSION);
    assert.deepEqual(sendMessages(dir, []), { mode: 'none' });
    addMessage(dir, { text: 'a' });
    addMessage(dir, { text: 'b' });
    updateState(dir, { turnActive: true });
    assert.deepEqual(sendMessages(dir, [1]), { mode: 'end', count: 1 });
    assert.equal(listMessages(dir).messages.length, 2);
    updateState(dir, { turnActive: false, atEnd: null });
    const sent = sendMessages(dir, [2]);
    assert.equal(sent.mode, 'now');
    assert.equal(sent.mode === 'now' && sent.text, '[cmc] The user released their held message with "/send":\n1. b');
  });

  it('takes nothing out on "now": only takeMessages does, by id, once the prompt was accepted', () => {
    const dir = sessionDir(dataDir(), SESSION);
    addMessage(dir, { text: 'a' });
    addMessage(dir, { text: 'b' });
    const sent = sendMessages(dir, []);
    assert.equal(listMessages(dir).messages.length, 2);
    const ids = sent.mode === 'now' ? sent.ids : [];
    assert.equal(takeMessages(dir, ids), 2);
    assert.equal(listMessages(dir).messages.length, 0);
    // Already taken (or deleted meanwhile): nothing more to take.
    assert.equal(takeMessages(dir, ids), 0);
  });
});

describe('hooks module', () => {
  it('takes one session start for the indicator and the interface, as the engine requires', () => {
    const events: string[] = [];
    registerModule(((event: string) => {
      events.push(event);
    }) as never);
    assert.deepEqual(events.filter((event) => event === 'session.start'), ['session.start']);
    assert.ok(events.includes('prompt.submit'));
    assert.ok(events.includes('command.run'));
  });
});
