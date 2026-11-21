// cmc — control panel (hooks module), driven with a stand-in engine that runs the real command line. Author: Peterson Sena (r3v3rs3).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import { clearPendingInBox, pendingIn, register as registerInterface, startInterface } from '../plugins/cmc/hooks/interface.ts';
import {
  AUTHOR,
  AUTHOR_URL,
  COLORS,
  dispatchToast,
  drawPanel,
  elapsed,
  fateOf,
  firstSentence,
  isWorking,
  MARK,
  noteActivity,
  openPanel,
  PANE_ID,
  PRODUCT_NAME,
  parseAgents,
  parseConversation,
  parseQueue,
  readModes,
  register,
  resetPanelState,
  rowText,
  sendsAtEnd,
  startPanel,
  stateMark,
  statusLine,
  type PanelEngine,
} from '../plugins/cmc/hooks/panel.ts';
import { sessionDir } from '../plugins/cmc/lib/paths.ts';
import { addMessage, listMessages } from '../plugins/cmc/lib/queue.ts';
import { readState, updateState } from '../plugins/cmc/lib/session-state.ts';
import { present } from '../test-support/expect.ts';

const ROOT = resolve('plugins/cmc');
const SESSION = '3e9b1c7a-5d2f-4a8e-b6c0-1f4d7a9e2b5c';
const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  resetPanelState();
  clearPendingInBox();
});

/** A drawn element, as the stand-in elements build it. */
interface Node {
  type: string;
  props: Record<string, unknown> & { children?: unknown };
}

const make = (type: string) => (props: Record<string, unknown>) => ({ type, props }) as Node;

/** Every node of a drawing, depth first. */
function nodes(tree: unknown): Node[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (typeof tree !== 'object' || tree === null || !('type' in tree)) return [];
  const node = tree as Node;
  return [node, ...nodes(node.props.children)];
}
const ofType = (tree: unknown, type: string) => nodes(tree).filter((node) => node.type === type);
const keys = (tree: unknown) => ofType(tree, 'Button').map((node) => String(node.props.key));
const texts = (tree: unknown) => ofType(tree, 'Text').map((node) => String(node.props.children));
const labels = (tree: unknown) => ofType(tree, 'Button').map((node) => String(node.props.label));
function find(tree: unknown, key: string): Node {
  const node = nodes(tree).find((one) => one.props.key === key);
  assert.ok(node, `no element "${key}" in ${JSON.stringify(keys(tree))}`);
  return node;
}
async function press(tree: unknown, key: string): Promise<void> {
  await (find(tree, key).props.onPress as () => Promise<unknown>)();
}
async function submitInput(tree: unknown, key: string, value: string): Promise<void> {
  await (find(tree, key).props.onSubmit as (value: string) => Promise<unknown>)(value);
}

function world() {
  const data = mkdtempSync(join(tmpdir(), 'cmc-panel-'));
  made.push(data);
  const opened: unknown[] = [];
  const registered: string[] = [];
  const submitted: string[] = [];
  const box = { text: '' };
  let invalidations = 0;
  let tick: (() => Promise<void>) | undefined;
  const $: PanelEngine = {
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
    clock: {
      sleep: async () => undefined,
      every: (_ms, task) => {
        tick = task;
      },
    },
    prompt: {
      read: async () => ({ text: box.text, cursor: box.text.length }),
      fill: async ({ text, mode }) => {
        box.text = mode === 'append' ? box.text + text : text;
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
    ui: {
      ask: async () => {
        throw new Error('no dialog in this test');
      },
      log: () => undefined,
      toast: () => undefined,
      open: async (pane) => {
        opened.push(pane);
        return { isPlaced: true };
      },
      invalidate: () => {
        invalidations += 1;
      },
      resolve: () => ({ Box: make('Box'), Text: make('Text'), Button: make('Button'), Input: make('Input'), Select: make('Select'), Link: make('Link') }) as never,
    },
  };
  const dir = sessionDir(data, SESSION);
  const draw = () => drawPanel($, { surface: 'terminal', component: 'Pane', requestId: PANE_ID });
  const ids = () => listMessages(dir).messages.map((message) => message.id);
  return {
    $,
    data,
    dir,
    draw,
    box,
    ids,
    opened,
    registered,
    submitted,
    held: () => listMessages(dir).messages.map((message) => message.text),
    invalidations: () => invalidations,
    tick: () => present(tick)(),
    start: async () => {
      await startInterface($);
      await startPanel($);
    },
  };
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i += 1) await new Promise((done) => setTimeout(done, 10));
};

describe('panel: what it reads and says', () => {
  it('reads each message of the queue file and skips lines it cannot read', () => {
    const text = `${JSON.stringify({ id: 'a1', text: 'one', source: 'user' })}\nnot json\n\n${JSON.stringify({ id: 'b2', text: 'two' })}\n`;
    assert.deepEqual(parseQueue(text), [
      { id: 'a1', text: 'one', source: 'user' },
      { id: 'b2', text: 'two', source: 'user' },
    ]);
  });

  it('shows one line per message, and says when it comes from a subagent', () => {
    assert.equal(rowText(1, { id: 'a', text: 'fix\nthe bug', source: 'user' }), '1  fix the bug');
    assert.equal(rowText(2, { id: 'b', text: 'done', source: 'agent 1a2b3c4d' }), '2  done (from subagent 1a2b3c4d)');
    assert.ok(rowText(1, { id: 'c', text: 'x'.repeat(200), source: 'user' }).endsWith('…'));
  });

  it('reads the agent state, the modes, and words the status and what happens to each message', () => {
    assert.equal(isWorking('{"turnActive":true}'), true);
    assert.equal(isWorking(''), false);
    assert.deepEqual(readModes(''), { sendAtEnd: 'true', holdTarget: 'main', 'dispatch.context': 'fork', 'dispatch.return': 'held', 'dispatch.model': 'inherit', 'dispatch.effort': 'inherit' });
    assert.deepEqual(readModes('{"sendAtEnd":false,"holdTarget":"subagent","dispatch":{"context":"pack","return":"auto"}}'), {
      sendAtEnd: 'false',
      holdTarget: 'subagent',
      'dispatch.context': 'pack',
      'dispatch.return': 'auto',
      'dispatch.model': 'inherit',
      'dispatch.effort': 'inherit',
    });
    assert.equal(sendsAtEnd('{"sendAtEnd":false}'), false);
    assert.equal(statusLine(false, true), '○ Agent idle · Send hands a message over now');
    assert.equal(statusLine(true, false), '● Agent working · Send puts a message in the prompt box (Ctrl+Enter)');
    const mine = { id: 'a', text: 'x', source: 'user' };
    assert.equal(fateOf(mine, true, true), 'goes when the turn ends');
    assert.equal(fateOf(mine, false, true), 'held until you send it');
    assert.equal(fateOf({ ...mine, source: 'agent 1a2b3c4d' }, true, true), 'subagent result');
  });

  it('words subagents: their age, their state, and who took a message', () => {
    assert.equal(elapsed('2026-11-21T10:00:00Z', '2026-11-21T10:00:27Z'), '27s');
    assert.equal(elapsed('2026-11-21T10:00:00Z', '2026-11-21T10:02:05Z'), '2m 05s');
    assert.equal(elapsed('2026-11-21T10:00:00Z', null, Date.parse('2026-11-21T10:00:09Z')), '9s');
    assert.deepEqual(stateMark('running'), { icon: '⟳', color: COLORS.working });
    assert.deepEqual(stateMark('finished'), { icon: '✓', color: COLORS.done });
    assert.deepEqual(stateMark('failed'), { icon: '✗', color: COLORS.error });
    assert.equal(firstSentence('[cmc] No such message. More.\nmore'), 'No such message.');
    assert.equal(
      dispatchToast('Held message 1 left the queue. Dispatched to agent 6e3ccfc8: it gets a short summary of this conversation.'),
      'Subagent 6e3ccfc8 took the message, with a summary of the conversation as context; it works apart and its result comes back here.',
    );
    assert.match(dispatchToast('Dispatched to agent 6e3ccfc8: it inherits this conversation.'), /with the whole conversation as context/);
    assert.deepEqual(parseAgents('not json'), []);
    assert.deepEqual(parseConversation('{"at":"x","role":"you","text":"hi"}\nbroken\n{"role":"robot","text":"no"}'), [{ at: 'x', role: 'you', text: 'hi' }]);
    assert.deepEqual(stateMark('waiting'), { icon: '●', color: COLORS.accent });
  });

  it('uses the violet palette', () => {
    assert.equal(COLORS.accent, '#7C5CFF');
  });

  it('has a two-line mark of equal width, where the logo goes', () => {
    assert.equal(MARK.length, 2);
    assert.equal(MARK[0]?.length, MARK[1]?.length);
  });
});

describe('panel: opening', () => {
  it('registers /cmc, which opens the pane and closes with Escape', async () => {
    const w = world();
    await w.start();
    assert.ok(w.registered.includes('cmc'));
    assert.equal(await openPanel(w.$), 'cmc panel opened. Escape closes it.');
    assert.deepEqual(w.opened, [{ id: PANE_ID, title: 'cmc hub', closeOnEscape: true }]);
  });

  it('says so when the terminal has no room for the pane', async () => {
    const w = world();
    await w.start();
    w.$.ui.open = async () => ({ isPlaced: false });
    assert.match(await openPanel(w.$), /too narrow/);
  });

  it('hooks the pane and the /cmc command', () => {
    const hooked: string[] = [];
    register(((event: string, matcher: Record<string, string>) => {
      hooked.push(`${event} ${JSON.stringify(matcher)}`);
    }) as never);
    assert.deepEqual(hooked, ['command.run {"command":"cmc"}', `ui.render {"component":"Pane","requestId":"${PANE_ID}"}`]);
  });
});

describe('panel: header, tabs and modes', () => {
  it('shows the state, three tabs with counts, and the modes with the one in force as primary', async () => {
    const w = world();
    await w.start();
    addMessage(w.dir, { text: 'one' });
    const tree = await w.draw();
    assert.ok(texts(tree).includes('○ Agent idle · Send hands a message over now'));
    const brand = find(tree, 'brand');
    assert.deepEqual(texts(brand.props.children), [...MARK, PRODUCT_NAME]);
    const author = find(brand.props.children, 'author');
    assert.equal(author.type, 'Link');
    assert.equal(author.props.label, 'by r3v3rs3', 'the text drawn; without it the terminal draws the URL');
    assert.equal(author.props.href, AUTHOR_URL);
    assert.equal(AUTHOR_URL, 'https://github.com/petersonsenadevs');
    assert.ok(ofType(brand.props.children, 'Text').slice(0, 2).every((node) => node.props.color === COLORS.accent));
    assert.equal(AUTHOR, 'by r3v3rs3');
    assert.deepEqual(
      ['tab-messages', 'tab-agents', 'tab-activity'].map((key) => find(tree, key).props.label),
      ['Messages 1', 'Subagents 0', 'Activity'],
    );
    assert.equal(find(tree, 'tab-messages').props.variant, 'primary');
    assert.equal(find(tree, 'mode-sendAtEnd-true').props.variant, 'primary');
    assert.equal(find(tree, 'mode-holdTarget-subagent').props.dimColor, true);
  });

  it('switches a mode with one click, into the settings file', async () => {
    const w = world();
    await w.start();
    await press(await w.draw(), 'mode-holdTarget-subagent');
    assert.deepEqual(JSON.parse(readFileSync(join(w.data, 'config.json'), 'utf8')), { holdTarget: 'subagent' });
    const tree = await w.draw();
    assert.equal(find(tree, 'mode-holdTarget-subagent').props.variant, 'primary');
    assert.ok(texts(tree).includes('Subagent mode on.'));
  });

  it('changes view with the tabs', async () => {
    const w = world();
    await w.start();
    await press(await w.draw(), 'tab-agents');
    assert.ok(texts(await w.draw()).some((text) => text.startsWith('No subagents yet.')));
    await press(await w.draw(), 'tab-activity');
    assert.ok(texts(await w.draw()).includes('Nothing has happened yet.'));
  });
});

describe('panel: messages', () => {
  it('shows an empty state and the hold box', async () => {
    const w = world();
    await w.start();
    const tree = await w.draw();
    assert.ok(texts(tree).some((text) => text.startsWith('Nothing is held.')));
    assert.equal(find(tree, 'hold-box').props.submitLabel, 'Hold');
  });

  it('shows each message on one line with what will happen to it; a click selects it and shows its actions', async () => {
    const w = world();
    await w.start();
    addMessage(w.dir, { text: 'one' });
    addMessage(w.dir, { text: 'two' });
    let tree = await w.draw();
    const [first, second] = w.ids();
    assert.deepEqual(
      labels(tree).filter((label) => /^\d {2}/.test(label)),
      ['1  one', '2  two'],
    );
    assert.ok(texts(tree).includes('· held until you send it'));
    assert.ok(!keys(tree).includes(`send-${first}`), 'actions show only on the selected row');
    await press(tree, `pick-${second}`);
    tree = await w.draw();
    assert.deepEqual(
      keys(tree).filter((key) => key.endsWith(String(second)) && !key.startsWith('pick')),
      [`send-${second}`, `agent-${second}`, `edit-${second}`, `up-${second}`, `down-${second}`, `delete-${second}`],
    );
    assert.ok(texts(tree).includes('▸'));
  });

  it('Send now with the agent idle hands the message over as a new prompt', async () => {
    const w = world();
    await w.start();
    addMessage(w.dir, { text: 'one' });
    addMessage(w.dir, { text: 'two' });
    const second = present(w.ids()[1]);
    await press(await w.draw(), `pick-${second}`);
    await press(await w.draw(), `send-${second}`);
    await until(() => w.held().length === 1);
    assert.deepEqual(w.submitted, ['[cmc] The user released their held message with "/send":\n1. two']);
    let tree = await w.draw();
    for (let i = 0; i < 100 && !texts(tree).includes('Sent 1 message to the agent.'); i += 1) {
      await new Promise((done) => setTimeout(done, 10));
      tree = await w.draw();
    }
    assert.ok(texts(tree).includes('Sent 1 message to the agent.'), 'the activity says it was sent, not only "Sending…"');
  });

  it('Send now while the agent works puts the text in the prompt box, and Ctrl+Enter takes it out of the queue', async () => {
    const w = world();
    await w.start();
    const hooks: Record<string, unknown> = {};
    registerInterface(((event: string, handler: unknown) => {
      hooks[event] = handler;
    }) as never);
    addMessage(w.dir, { text: 'also say kiwi' });
    updateState(w.dir, { turnActive: true });
    const id = present(w.ids()[0]);
    await press(await w.draw(), `pick-${id}`);
    await press(await w.draw(), `send-${id}`);
    assert.equal(w.box.text, 'also say kiwi');
    assert.deepEqual(w.held(), ['also say kiwi'], 'still held until the person sends it');
    assert.deepEqual(pendingIn('also say kiwi'), [id]);
    assert.ok(texts(await w.draw()).some((text) => text.startsWith('In the prompt box: press Ctrl+Enter')));
    // The person presses Ctrl+Enter: the prompt goes through the interface's prompt.submit hook.
    const submit = hooks['prompt.submit'] as ($: PanelEngine, e: { text: string }, next: (e: unknown) => Promise<unknown>) => Promise<unknown>;
    await submit(w.$, { text: 'also say kiwi' }, async (e) => ({ passed: e }));
    assert.deepEqual(w.held(), []);
    assert.deepEqual(pendingIn('also say kiwi'), []);
  });

  it('Send now while the agent works keeps a draft the person was typing', async () => {
    const w = world();
    await w.start();
    addMessage(w.dir, { text: 'kiwi' });
    updateState(w.dir, { turnActive: true });
    w.box.text = 'my own draft';
    const id = present(w.ids()[0]);
    await press(await w.draw(), `pick-${id}`);
    await press(await w.draw(), `send-${id}`);
    assert.equal(w.box.text, 'my own draft\nkiwi');
  });

  it('Edit changes the text in the row and keeps its place', async () => {
    const w = world();
    await w.start();
    addMessage(w.dir, { text: 'one' });
    addMessage(w.dir, { text: 'two' });
    const first = present(w.ids()[0]);
    await press(await w.draw(), `pick-${first}`);
    await press(await w.draw(), `edit-${first}`);
    const tree = await w.draw();
    assert.equal(find(tree, `edit-${first}`).type, 'Input');
    await submitInput(tree, `edit-${first}`, '--one, edited');
    assert.deepEqual(w.held(), ['--one, edited', 'two']);
  });

  it('moves a message up, and Delete removes it even if the queue moved since it was drawn', async () => {
    const w = world();
    await w.start();
    addMessage(w.dir, { text: 'one' });
    addMessage(w.dir, { text: 'two' });
    const second = present(w.ids()[1]);
    await press(await w.draw(), `pick-${second}`);
    await press(await w.draw(), `up-${second}`);
    assert.deepEqual(w.held(), ['two', 'one']);
    const tree = await w.draw();
    addMessage(w.dir, { text: 'zero' });
    await press(tree, `delete-${second}`);
    assert.deepEqual(w.held(), ['one', 'zero']);
  });

  it('the hold box holds what was typed; in subagent mode it offers to start a subagent instead', async () => {
    const w = world();
    await w.start();
    await submitInput(await w.draw(), 'hold-box', 'typed in the panel');
    assert.deepEqual(w.held(), ['typed in the panel']);
    writeFileSync(join(w.data, 'config.json'), JSON.stringify({ holdTarget: 'subagent' }));
    assert.equal(find(await w.draw(), 'hold-box').props.submitLabel, 'To subagent');
  });

  it('Send all and Clear act on the whole queue', async () => {
    const w = world();
    await w.start();
    addMessage(w.dir, { text: 'one' });
    addMessage(w.dir, { text: 'two' });
    await press(await w.draw(), 'send-all');
    await until(() => w.held().length === 0);
    assert.equal(w.submitted.length, 1);
    addMessage(w.dir, { text: 'three' });
    await press(await w.draw(), 'clear');
    assert.deepEqual(w.held(), []);
  });

  it('an action on a message that is gone says so in the activity', async () => {
    const w = world();
    await w.start();
    addMessage(w.dir, { text: 'one' });
    const id = present(w.ids()[0]);
    await press(await w.draw(), `pick-${id}`);
    const tree = await w.draw();
    spawnSync('node', [join(ROOT, 'bin/cmc.ts'), 'take', id, '--data-dir', w.data, '--session', SESSION], { cwd: tmpdir() });
    await press(tree, `agent-${id}`);
    assert.ok(texts(await w.draw()).includes('That message is no longer held.'));
  });
});

describe('panel: subagents', () => {
  /** Writes a subagent record as the dispatcher does, without starting anything. */
  function agent(w: ReturnType<typeof world>, fields: Record<string, unknown>) {
    const id = String(fields.id);
    const dir = join(w.dir, 'agents', id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'agent.json'),
      JSON.stringify({
        id,
        task: 'summarise what we talked about',
        state: 'finished',
        mode: 'fork',
        cwd: tmpdir(),
        worktree: null,
        command: ['claude'],
        runnerPid: null,
        pid: null,
        startedAt: '2026-11-21T10:00:00.000Z',
        endedAt: '2026-11-21T10:00:27.000Z',
        exitCode: 0,
        summary: 'We built a plugin that holds messages.',
        ...fields,
      }),
    );
  }

  /** Writes a subagent's conversation as its supervisor does. */
  function chat(w: ReturnType<typeof world>, id: string, entries: [string, string][]) {
    const lines = entries.map(([role, text], index) => JSON.stringify({ at: `2026-11-21T10:0${index}:00.000Z`, role, text }));
    writeFileSync(join(w.dir, 'agents', id, 'conversation.jsonl'), `${lines.join('\n')}\n`);
  }
  /** The chat bubbles of a drawing: who speaks, on which side, and what they say. */
  function bubbles(tree: unknown): string[] {
    return nodes(tree)
      .filter((node) => node.type === 'Box' && (node.props.justifyContent === 'flex-end' || node.props.justifyContent === 'flex-start'))
      .map((node) => {
        const words = texts(node.props.children);
        return `${node.props.justifyContent === 'flex-end' ? 'right' : 'left'} ${(words[0] ?? '').split('  ')[0]}: ${words[1] ?? ''}`;
      });
  }

  it('lists each subagent; selecting one shows the conversation as a chat, in order, you on the right and it on the left', async () => {
    const w = world();
    await w.start();
    agent(w, { id: 'ab12cd34' });
    chat(w, 'ab12cd34', [
      ['you', 'summarise what we talked about'],
      ['step', 'Read README.md'],
      ['agent', 'We built a plugin that holds messages.'],
      ['you', 'and the open tasks?'],
      ['agent', 'F5-T7 and F5-T8.'],
      ['note', 'Its session closed.'],
    ]);
    addMessage(w.dir, { text: 'Agent ab12cd34 finished…', source: 'agent ab12cd34' });
    await press(await w.draw(), 'tab-agents');
    let tree = await w.draw();
    assert.equal(find(tree, 'tab-agents').props.label, 'Subagents 1');
    assert.ok(texts(tree).includes('· finished · 27s · whole conversation'));
    await press(tree, 'agent-pick-ab12cd34');
    tree = await w.draw();
    assert.ok(texts(tree).some((text) => text.startsWith('Sent with the whole conversation as context')));
    assert.deepEqual(bubbles(tree), [
      'right You: summarise what we talked about',
      'left Agent: We built a plugin that holds messages.',
      'right You: and the open tasks?',
      'left Agent: F5-T7 and F5-T8.',
    ]);
    assert.ok(texts(tree).includes('   › Read README.md'), 'its steps, between the messages');
    assert.ok(texts(tree).includes('   — Its session closed.'));
    await press(tree, 'to-main-ab12cd34');
    await until(() => w.held().length === 0);
    assert.equal(w.submitted.length, 1);
  });

  it('writes to a subagent from its conversation: a waiting one gets it in its inbox', async () => {
    const w = world();
    await w.start();
    agent(w, { id: 'cd34ef56', state: 'waiting', endedAt: null, runnerPid: process.pid, pid: process.pid });
    chat(w, 'cd34ef56', [['you', 'first task'], ['agent', 'done']]);
    await press(await w.draw(), 'tab-agents');
    await press(await w.draw(), 'agent-pick-cd34ef56');
    let tree = await w.draw();
    assert.ok(texts(tree).includes('● waiting for you: write below, or it closes after a while'));
    assert.equal(find(tree, 'tell-cd34ef56').props.placeholder, 'Write to cd34ef56');
    await submitInput(tree, 'tell-cd34ef56', 'one more thing');
    const inbox = readFileSync(join(w.dir, 'agents', 'cd34ef56', 'inbox.jsonl'), 'utf8');
    assert.equal((JSON.parse(inbox.trim()) as { text: string }).text, 'one more thing');
    tree = await w.draw();
    assert.equal(bubbles(tree).at(-1), 'right You: one more thing');
    assert.ok(texts(tree).includes('Sent to agent cd34ef56.'));
  });

  it('a working subagent can be stopped, has no result to send yet, and says it reads messages after its step', async () => {
    const w = world();
    await w.start();
    agent(w, { id: 'ef56ab78', state: 'running', endedAt: null, summary: null, mode: 'pack', runnerPid: process.pid, pid: process.pid });
    await press(await w.draw(), 'tab-agents');
    await press(await w.draw(), 'agent-pick-ef56ab78');
    const tree = await w.draw();
    assert.ok(keys(tree).includes('stop-ef56ab78'));
    assert.ok(!keys(tree).includes('to-main-ef56ab78'));
    assert.ok(texts(tree).some((text) => text.startsWith('Sent with a summary of the conversation as context')));
    assert.equal(find(tree, 'tell-ef56ab78').props.placeholder, 'Write to ef56ab78: it reads it after its current step');
    assert.deepEqual(bubbles(tree), ['right You: summarise what we talked about'], 'with no conversation yet, the task');
  });
});

describe('panel: activity and refresh', () => {
  it('notes what happened, newest first, and shows the last two under the other views', async () => {
    const w = world();
    await w.start();
    noteActivity('first', false, new Date('2026-11-21T19:42:00'));
    noteActivity('second', false, new Date('2026-11-21T19:43:00'));
    noteActivity('third went wrong', true, new Date('2026-11-21T19:44:00'));
    const tree = await w.draw();
    assert.ok(texts(tree).includes('third went wrong'));
    assert.ok(texts(tree).includes('second'));
    assert.ok(!texts(tree).includes('first'));
    const error = ofType(tree, 'Text').find((node) => node.props.children === 'third went wrong');
    assert.equal(error?.props.color, COLORS.error);
  });

  it('redraws by itself when the queue or the state changes, and not otherwise', async () => {
    const w = world();
    await w.start();
    await w.tick();
    assert.equal(w.invalidations(), 0);
    addMessage(w.dir, { text: 'typed meanwhile' });
    await w.tick();
    assert.equal(w.invalidations(), 1);
    await w.tick();
    assert.equal(w.invalidations(), 1);
    updateState(w.dir, { turnActive: true });
    await w.tick();
    assert.equal(w.invalidations(), 2);
    assert.equal(readState(w.dir).turnActive, true);
  });
});
