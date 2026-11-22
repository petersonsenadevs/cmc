// cmc — interactive interface (hooks module): hold on Enter, /held and /send. Author: Peterson Sena (r3v3rs3).
// The stand-in engine runs the real cmc command line, so the module is tested
// against the same core, lock and files as everywhere else.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import {
  ACTIONS,
  COMMANDS,
  labelFor,
  noticeFor,
  pickOptions,
  readPick,
  reminderFor,
  holdPrefixFrom,
  prefixesFrom,
  messageToDispatch,
  messageToHold,
  positionsFrom,
  register,
  startInterface,
  type CommandRunEvent,
  type InterfaceEngine,
  type PromptSubmitEvent,
  type TurnCompleteEvent,
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
  turn?: ($: InterfaceEngine, e: TurnCompleteEvent, next: (e: TurnCompleteEvent) => Promise<unknown>) => Promise<unknown>;
};

/** A `$` whose `process.run` runs the real command, plus a record of what the module did to the screen. */
function engine(data: string, box = '') {
  const submitted: string[] = [];
  const filled: string[] = [];
  const registered: string[] = [];
  const logged: string[] = [];
  const asked: { question: string; options: readonly string[] }[] = [];
  /** What the person picks in each dialog, in order; `null` closes it. */
  const answers: (string | null)[] = [];
  const state = { box };
  const $: InterfaceEngine = {
    session: { id: async () => SESSION, send: async () => ({ isDelivered: false, reason: 'no live session' }) },
    plugin: { root: ROOT },
    process: {
      hookEnv: async () => ({ CLAUDE_PLUGIN_DATA: data }),
      run: async (argv, init) => {
        const [command, ...args] = argv;
        const run = spawnSync(present(command), args, { input: init?.stdin ?? '', encoding: 'utf8', cwd: tmpdir() });
        return { exitCode: run.status ?? 1, stdout: run.stdout, stderr: run.stderr };
      },
    },
    fs: { read: async (path) => readFileSync(path, 'utf8') },
    ui: {
      ask: async (question, { options }) => {
        asked.push({ question, options });
        const answer = answers.shift();
        if (answer === undefined || answer === null) throw new Error('dismissed');
        return answer;
      },
      log: (text) => {
        logged.push(text);
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
  return { $, submitted, filled, registered, logged, asked, answers, state };
}

async function started(world: ReturnType<typeof engine>): Promise<Required<Hooks>> {
  const hooks: Hooks = {};
  register(((event: string, handler: never) => {
    if (event === 'prompt.submit') hooks.submit = handler;
    if (event === 'command.run') hooks.command = handler;
    if (event === 'turn.complete') hooks.turn = handler;
  }) as never);
  await startInterface(world.$);
  return { submit: present(hooks.submit), command: present(hooks.command), turn: present(hooks.turn) };
}

const passed = async <E>(e: E) => ({ passed: e });
const settle = () => new Promise((done) => setImmediate(done));
/** Waits for what /send does after its command has answered. */
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i += 1) await new Promise((done) => setTimeout(done, 10));
}

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

  it('says in the notice whether the message goes by itself when the turn ends', () => {
    assert.equal(noticeFor('Held (2 queued). It goes to the agent when its turn ends; /held to change or delete it.'), 'cmc: held (2) · goes to the agent when its turn ends · /held to change it');
    assert.equal(noticeFor('Held (1 queued). /held or /send to send it.'), 'cmc: held (1) · /held or /send to send it');
    assert.equal(noticeFor('Dispatched to agent ab12cd34: it inherits this conversation.'), 'cmc: sent to subagent ab12cd34 · it works apart; its result comes back to /cmc');
  });

  it('takes the hold prefix from the settings only when it is a valid one', () => {
    assert.equal(holdPrefixFrom(null), ';;');
    assert.equal(holdPrefixFrom('{"holdPrefix":"!!"}'), '!!');
    assert.equal(holdPrefixFrom('{"holdPrefix":"ab"}'), ';;');
    assert.equal(holdPrefixFrom('{"holdPrefix":"/x"}'), ';;');
    assert.equal(holdPrefixFrom('not json'), ';;');
  });

  it('reads the dispatch prefix too, and falls back to both defaults when the two overlap', () => {
    assert.deepEqual(prefixesFrom(null), { hold: ';;', dispatch: '>>' });
    assert.deepEqual(prefixesFrom('{"dispatchPrefix":"=>"}'), { hold: ';;', dispatch: '=>' });
    assert.deepEqual(prefixesFrom('{"holdPrefix":">","dispatchPrefix":">>"}'), { hold: ';;', dispatch: '>>' });
  });

  it('takes what follows the dispatch prefix as the task, flags and all', () => {
    assert.equal(messageToDispatch('>> -m haiku review it', '>>'), '-m haiku review it');
    assert.equal(messageToDispatch('>>review it', '>>'), 'review it');
    assert.equal(messageToDispatch('>>   ', '>>'), null);
    assert.equal(messageToDispatch('fix >> this', '>>'), null);
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
    assert.deepEqual(answer, { drop: 'cmc: held (1) · /held or /send to send it' });
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

  it('starts a subagent on ">> task" itself: the whole text, flags included, goes to the command line, one-line notice, box emptied', async () => {
    const world = engine(dataDir(), '>> -m haiku -e low write a haiku');
    const { submit } = await started(world);
    const calls: { argv: readonly string[]; stdin?: string }[] = [];
    world.$.process.run = async (argv, init) => {
      calls.push({ argv, ...(init?.stdin === undefined ? {} : { stdin: init.stdin }) });
      return { exitCode: 0, stdout: 'Dispatched to agent ab12cd34: it inherits this conversation.', stderr: '' };
    };
    const answer = await submit(world.$, { text: '>> -m haiku -e low write a haiku' }, passed);
    assert.deepEqual(answer, { drop: 'cmc: sent to subagent ab12cd34 · it works apart; its result comes back to /cmc' });
    assert.deepEqual(calls[0]?.argv.slice(2, 4), ['dispatch', '--stdin']);
    assert.equal(calls[0]?.stdin, '-m haiku -e low write a haiku');
    await settle();
    assert.deepEqual(world.filled, ['']);
  });

  it('hands ">> task" on when the command line refuses it, so the command hooks say why', async () => {
    const world = engine(dataDir());
    const { submit } = await started(world);
    world.$.process.run = async () => ({ exitCode: 1, stdout: '', stderr: '"x y" is not a model name.' });
    const e = { text: '>> -m "x y" task' };
    assert.deepEqual(await submit(world.$, e, passed), { passed: e });
  });

  it('hands the prompt on when the command line fails, so the command hooks still hold it', async () => {
    const world = engine(dataDir());
    const { submit } = await started(world);
    world.$.process.run = async () => ({ exitCode: 1, stdout: '', stderr: 'broken' });
    const e = { text: ';; keep me' };
    assert.deepEqual(await submit(world.$, e, passed), { passed: e });
  });

  it('/held falls back to a plain list when the dialog cannot open (headless) or is closed', async () => {
    const data = dataDir();
    const world = engine(data);
    const { submit, command } = await started(world);
    await submit(world.$, { text: ';; one' }, passed);
    await submit(world.$, { text: ';; two' }, passed);
    const answer = (await command(world.$, { command: 'held', args: '' }, passed)) as { text: string; isTextDisplayOnly: true };
    assert.equal(answer.isTextDisplayOnly, true);
    assert.match(answer.text, /2 held:\n1 · one\n2 · two\n/);
  });

  it('/send with the agent idle submits the messages as a new prompt at once', async () => {
    const data = dataDir();
    const world = engine(data);
    const { submit, command } = await started(world);
    await submit(world.$, { text: ';; one' }, passed);
    await submit(world.$, { text: ';; two' }, passed);
    const answer = await command(world.$, { command: 'send', args: '2' }, passed);
    assert.deepEqual(answer, { text: 'Sending 1 held message(s)…', isTextDisplayOnly: true });
    const left = () => listMessages(sessionDir(data, SESSION)).messages.map((message) => message.text);
    await until(() => left().length === 1);
    assert.deepEqual(world.submitted, ['[cmc] The user released their held message with "/send":\n1. two']);
    assert.deepEqual(left(), ['one']);
  });

  it('/send keeps the messages held when the engine refuses the prompt (as it does headless)', async () => {
    const data = dataDir();
    const world = engine(data);
    const { submit, command } = await started(world);
    await submit(world.$, { text: ';; mango' }, passed);
    world.$.prompt.submit = async () => {
      throw new Error('no prompt box');
    };
    await command(world.$, { command: 'send', args: '' }, passed);
    await until(() => world.logged.length > 0);
    assert.deepEqual(world.logged, ['cmc: could not send them (no prompt box); they are still held. /cmc:release sends them as a prompt.']);
    assert.deepEqual(listMessages(sessionDir(data, SESSION)).messages.map((message) => message.text), ['mango']);
  });

  it('/send keeps the messages held when a hook drops the prompt', async () => {
    const data = dataDir();
    const world = engine(data);
    const { submit, command } = await started(world);
    await submit(world.$, { text: ';; mango' }, passed);
    world.$.prompt.submit = async () => ({ drop: 'blocked by policy' });
    await command(world.$, { command: 'send', args: '' }, passed);
    await until(() => world.logged.length > 0);
    assert.match(world.logged[0] ?? '', /blocked by policy/);
    assert.deepEqual(listMessages(sessionDir(data, SESSION)).messages.map((message) => message.text), ['mango']);
  });

  it('/send while the agent works waits for the end of its turn and submits nothing', async () => {
    const data = dataDir();
    const world = engine(data);
    const { submit, command } = await started(world);
    await submit(world.$, { text: ';; one' }, passed);
    updateState(sessionDir(data, SESSION), { turnActive: true });
    const answer = await command(world.$, { command: 'send', args: '' }, passed);
    assert.deepEqual(answer, { text: 'Could not send it into the running turn (no live session); it goes when the turn ends.', isTextDisplayOnly: true });
    assert.deepEqual(world.submitted, []);
    assert.equal(readState(sessionDir(data, SESSION)).atEnd, 'all');
  });

  it('/send while the agent works hands the message into the running turn when the engine delivers it', async () => {
    const data = dataDir();
    const world = engine(data);
    const { submit, command } = await started(world);
    await submit(world.$, { text: ';; one' }, passed);
    await submit(world.$, { text: ';; two' }, passed);
    updateState(sessionDir(data, SESSION), { turnActive: true });
    const delivered: { to: unknown; text: string }[] = [];
    world.$.session.send = async (args) => {
      delivered.push(args);
      return { isDelivered: true };
    };
    const answer = await command(world.$, { command: 'send', args: '2' }, passed);
    assert.deepEqual(answer, { text: 'Sent now: the agent reads it after the step it is on.', isTextDisplayOnly: true });
    assert.deepEqual(delivered, [{ to: { sessionId: SESSION }, text: '[cmc] The user sends you their held message now, while you work (with "/send"):\n1. two' }]);
    assert.deepEqual(listMessages(sessionDir(data, SESSION)).messages.map((message) => message.text), ['one']);
    assert.equal(readState(sessionDir(data, SESSION)).atEnd, null, 'nothing armed');
    assert.deepEqual(world.submitted, []);
  });

  it('/send while the agent works keeps the message for the end of the turn when the engine throws', async () => {
    const data = dataDir();
    const world = engine(data);
    const { submit, command } = await started(world);
    await submit(world.$, { text: ';; one' }, passed);
    updateState(sessionDir(data, SESSION), { turnActive: true });
    world.$.session.send = async () => {
      throw new Error('channel closed');
    };
    const answer = (await command(world.$, { command: 'send', args: '' }, passed)) as { text: string };
    assert.equal(answer.text, 'Could not send it into the running turn (channel closed); it goes when the turn ends.');
    assert.deepEqual(listMessages(sessionDir(data, SESSION)).messages.map((message) => message.text), ['one']);
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


describe('interface: the /held menu', () => {
  async function withHeld(...texts: string[]) {
    const data = dataDir();
    const world = engine(data);
    const hooks = await started(world);
    for (const text of texts) await hooks.submit(world.$, { text: `;; ${text}` }, passed);
    const held = () => listMessages(sessionDir(data, SESSION)).messages.map((message) => message.text);
    const run = async (...answers: (string | null)[]) => {
      world.answers.push(...answers);
      return (await hooks.command(world.$, { command: 'held', args: '' }, passed)) as { text: string };
    };
    return { data, world, hooks, held, run };
  }

  it('shows short labels, and "Send all" only when there are several', () => {
    assert.equal(labelFor(2, 'one\n  two'), '2 · one two');
    assert.equal(labelFor(1, 'x'.repeat(80)).length, '1 · '.length + 48);
    const entries = ['a', 'b', 'c', 'd', 'e'].map((text, index) => ({ id: String(index), text, source: 'user' }));
    assert.deepEqual(pickOptions(entries.slice(0, 1)), ['1 · a']);
    assert.deepEqual(pickOptions(entries), ['1 · a', '2 · b', '3 · c', 'Send all 5']);
    assert.equal(readPick('2 · b', entries), 2);
    assert.equal(readPick('Send all 5', entries), 'all');
    assert.equal(readPick('5', entries), 5);
    assert.equal(readPick('#4', entries), 4);
    assert.equal(readPick('9', entries), null);
    assert.equal(readPick('banana', entries), null);
  });

  it('with one message goes straight to what to do with it, and "Send" submits it', async () => {
    const { world, held, run } = await withHeld('mango');
    const answer = await run('Send');
    assert.equal(world.asked.length, 1);
    assert.deepEqual(world.asked[0]?.options, [...ACTIONS]);
    assert.match(world.asked[0]?.question ?? '', /Message 1: «mango»/);
    assert.equal(answer.text, 'Sending 1 held message(s)…');
    await until(() => held().length === 0);
    assert.deepEqual(world.submitted, ['[cmc] The user released their held message with "/send":\n1. mango']);
    assert.deepEqual(held(), []);
  });

  it('picks a message, then deletes it', async () => {
    const { world, held, run } = await withHeld('one', 'two', 'three');
    const answer = await run('2 · two', 'Delete');
    assert.deepEqual(world.asked[0]?.options, ['1 · one', '2 · two', '3 · three', 'Send all 3']);
    assert.equal(answer.text, 'Deleted: «two».');
    assert.deepEqual(held(), ['one', 'three']);
  });

  it('"Send all" sends every message', async () => {
    const { world, held, run } = await withHeld('one', 'two');
    await run('Send all 2');
    await until(() => held().length === 0);
    assert.equal(world.submitted.length, 1);
    assert.deepEqual(held(), []);
  });

  it('reaches a message past the third by typing its number', async () => {
    const { world, held, run } = await withHeld('a', 'b', 'c', 'd');
    await run('4', 'Delete');
    assert.match(world.asked[0]?.question ?? '', /type its number for 4–4/);
    assert.deepEqual(held(), ['a', 'b', 'c']);
  });

  it('text typed under "Other" replaces the message in its place', async () => {
    const { held, run } = await withHeld('one', 'two');
    const answer = await run('1 · one', '--now with dashes');
    assert.match(answer.text, /1/);
    assert.deepEqual(held(), ['--now with dashes', 'two']);
  });

  it('"Edit" puts the message back in the prompt box as an edit control word', async () => {
    const { world, held, run } = await withHeld('fix the typo');
    const answer = await run('Edit');
    assert.deepEqual(world.filled.at(-1), ';;edit 1 fix the typo');
    assert.match(answer.text, /press Enter/);
    assert.deepEqual(held(), ['fix the typo']);
  });

  it('closing a dialog changes nothing and shows the list', async () => {
    const { held, run } = await withHeld('one', 'two');
    const answer = await run('1 · one', null);
    assert.match(answer.text, /2 held:/);
    assert.deepEqual(held(), ['one', 'two']);
  });

  it('a number that is not there changes nothing', async () => {
    const { held, run } = await withHeld('one', 'two');
    assert.equal((await run('7')).text, 'No such message: nothing changed.');
    assert.deepEqual(held(), ['one', 'two']);
  });

  it('with nothing held says so without opening a dialog', async () => {
    const { world, run } = await withHeld();
    assert.equal((await run()).text, 'Nothing is held.');
    assert.equal(world.asked.length, 0);
  });
});

describe('interface: the end of a turn', () => {
  it('reminds the person of what is still held, and says nothing when the queue is empty', async () => {
    assert.equal(reminderFor(0), null);
    assert.equal(reminderFor(1), 'cmc: 1 message is still held. /held to send, edit or delete, /send to send all.');
    const data = dataDir();
    const world = engine(data);
    const { submit, turn } = await started(world);
    await turn(world.$, { reason: 'answer' }, passed);
    assert.deepEqual(world.logged, []);
    await submit(world.$, { text: ';; piña' }, passed);
    const result = await turn(world.$, { reason: 'answer' }, passed);
    assert.deepEqual(result, { passed: { reason: 'answer' } });
    assert.deepEqual(world.logged, ['cmc: 1 message is still held. /held to send, edit or delete, /send to send all.']);
  });

  it('an interrupted turn (Esc) leaves the agent idle, so /send hands messages over at once', async () => {
    const data = dataDir();
    const world = engine(data);
    const { submit, command, turn } = await started(world);
    await submit(world.$, { text: ';; piña' }, passed);
    updateState(sessionDir(data, SESSION), { turnActive: true });
    await turn(world.$, { reason: 'aborted' }, passed);
    assert.equal(readState(sessionDir(data, SESSION)).turnActive, false);
    assert.deepEqual(await command(world.$, { command: 'send', args: '' }, passed), { text: 'Sending 1 held message(s)…', isTextDisplayOnly: true });
  });
});

describe('command line for the interface', () => {
  const cmc = (data: string, ...args: string[]) =>
    spawnSync('node', [join(ROOT, 'bin/cmc.ts'), ...args, '--data-dir', data, '--session', SESSION], { encoding: 'utf8', cwd: tmpdir() });

  it('lists as JSON, edits text that starts with dashes after "--", and marks the agent idle', () => {
    const data = dataDir();
    addMessage(sessionDir(data, SESSION), { text: 'first' });
    const listed = JSON.parse(cmc(data, 'list', '--format', 'json').stdout) as { text: string; source: string }[];
    assert.deepEqual(listed.map(({ text, source }) => ({ text, source })), [{ text: 'first', source: 'user' }]);
    const edited = spawnSync('node', [join(ROOT, 'bin/cmc.ts'), 'edit', '1', '--data-dir', data, '--session', SESSION, '--', '--force it'], { encoding: 'utf8', cwd: tmpdir() });
    assert.equal(edited.status, 0, edited.stdout);
    assert.equal(listMessages(sessionDir(data, SESSION)).messages[0]?.text, '--force it');
    updateState(sessionDir(data, SESSION), { turnActive: true });
    assert.equal(cmc(data, 'idle').stdout.trim(), 'The agent is idle.');
    assert.equal(readState(sessionDir(data, SESSION)).turnActive, false);
  });

  it('refuses dispatch --message with a task or a bad number', () => {
    const data = dataDir();
    assert.match(cmc(data, 'dispatch', '--message', '0').stdout, /dispatch --message <N> with no task text/);
    assert.match(cmc(data, 'dispatch', '--message', '1', 'extra').stdout, /dispatch --message <N> with no task text/);
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
