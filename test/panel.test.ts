// cmc — control panel (hooks module), driven with a stand-in engine that runs the real command line. Author: Peterson Sena (r3v3rs3).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { startInterface } from '../plugins/cmc/hooks/interface.ts';
import { drawPanel, openPanel, PANE_ID, parseQueue, register, rowText, startPanel, type PanelEngine } from '../plugins/cmc/hooks/panel.ts';
import { sessionDir } from '../plugins/cmc/lib/paths.ts';
import { addMessage, listMessages } from '../plugins/cmc/lib/queue.ts';
import { present } from '../test-support/expect.ts';

const ROOT = resolve('plugins/cmc');
const SESSION = '3e9b1c7a-5d2f-4a8e-b6c0-1f4d7a9e2b5c';
const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
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
const buttons = (tree: unknown) => nodes(tree).filter((node) => node.type === 'Button');
const texts = (tree: unknown) => nodes(tree).filter((node) => node.type === 'Text').map((node) => String(node.props.children));
async function press(tree: unknown, key: string): Promise<void> {
  const button = present(buttons(tree).find((node) => node.props.key === key));
  await (button.props.onPress as () => Promise<unknown>)();
}

function world() {
  const data = mkdtempSync(join(tmpdir(), 'cmc-panel-'));
  made.push(data);
  const opened: unknown[] = [];
  const registered: string[] = [];
  const submitted: string[] = [];
  let invalidations = 0;
  let tick: (() => Promise<void>) | undefined;
  const $: PanelEngine = {
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
    fs: { read: async (path) => readFileSync(path, 'utf8') },
    clock: {
      sleep: async () => undefined,
      every: (_ms, task) => {
        tick = task;
      },
    },
    prompt: {
      read: async () => ({ text: '', cursor: 0 }),
      fill: async () => undefined,
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
      open: async (pane) => {
        opened.push(pane);
        return { isPlaced: true };
      },
      invalidate: () => {
        invalidations += 1;
      },
      resolve: () => ({ Box: make('Box'), Text: make('Text'), Button: make('Button') }) as never,
    },
  };
  const dir = sessionDir(data, SESSION);
  const draw = () => drawPanel($, { surface: 'terminal', component: 'Pane', requestId: PANE_ID });
  return {
    $,
    dir,
    draw,
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

describe('panel: reading the queue', () => {
  it('reads each message of the queue file and skips lines it cannot read', () => {
    const text = `${JSON.stringify({ id: 'a1', text: 'one', source: 'user' })}\nnot json\n\n${JSON.stringify({ id: 'b2', text: 'two' })}\n`;
    assert.deepEqual(parseQueue(text), [
      { id: 'a1', text: 'one', source: 'user' },
      { id: 'b2', text: 'two', source: 'user' },
    ]);
  });

  it('shows one line per message, and says when it comes from an agent', () => {
    assert.equal(rowText(1, { id: 'a', text: 'fix\nthe bug', source: 'user' }), '1. fix the bug');
    assert.equal(rowText(2, { id: 'b', text: 'done', source: 'agent 1a2b3c4d' }), '2. done (from agent 1a2b3c4d)');
    assert.ok(rowText(1, { id: 'c', text: 'x'.repeat(200), source: 'user' }).endsWith('…'));
  });
});

describe('panel: in a session', () => {
  it('registers /cmc, which opens the pane and closes with Escape', async () => {
    const w = world();
    await w.start();
    assert.ok(w.registered.includes('cmc'));
    assert.equal(await openPanel(w.$), 'cmc panel opened. Escape closes it.');
    assert.deepEqual(w.opened, [{ id: PANE_ID, title: 'cmc', closeOnEscape: true }]);
  });

  it('says so when the terminal has no room for the pane', async () => {
    const w = world();
    await w.start();
    w.$.ui.open = async () => ({ isPlaced: false });
    assert.match(await openPanel(w.$), /too narrow/);
  });

  it('shows an empty state, then each held message with its buttons', async () => {
    const w = world();
    await w.start();
    let tree = await w.draw();
    assert.ok(texts(tree).includes('Nothing is held'));
    assert.deepEqual(buttons(tree), []);
    addMessage(w.dir, { text: 'one' });
    addMessage(w.dir, { text: 'two' });
    tree = await w.draw();
    assert.ok(texts(tree).includes('✉ 2 held'));
    assert.ok(texts(tree).includes('1. one'));
    const ids = listMessages(w.dir).messages.map((message) => message.id);
    assert.deepEqual(
      buttons(tree).map((button) => button.props.key),
      [`send-${ids[0]}`, `delete-${ids[0]}`, `send-${ids[1]}`, `delete-${ids[1]}`, 'send-all', 'clear'],
    );
  });

  it('Delete removes that message, even if the queue moved since it was drawn', async () => {
    const w = world();
    await w.start();
    addMessage(w.dir, { text: 'one' });
    addMessage(w.dir, { text: 'two' });
    const tree = await w.draw();
    const two = present(listMessages(w.dir).messages[1]).id;
    addMessage(w.dir, { text: 'zero' }); // changes nothing about which message the button means
    await press(tree, `delete-${two}`);
    assert.deepEqual(w.held(), ['one', 'zero']);
    assert.ok(w.invalidations() > 0, 'redrawn at once');
  });

  it('Send hands that message over (agent idle: as a new prompt)', async () => {
    const w = world();
    await w.start();
    addMessage(w.dir, { text: 'one' });
    addMessage(w.dir, { text: 'two' });
    const tree = await w.draw();
    await press(tree, `send-${present(listMessages(w.dir).messages[1]).id}`);
    await until(() => w.held().length === 1);
    assert.deepEqual(w.submitted, ['[cmc] The user released their held message with "/send":\n1. two']);
    assert.deepEqual(w.held(), ['one']);
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

  it('redraws by itself when the queue changes, and not otherwise', async () => {
    const w = world();
    await w.start();
    await w.tick();
    assert.equal(w.invalidations(), 0);
    addMessage(w.dir, { text: 'typed meanwhile' });
    await w.tick();
    assert.equal(w.invalidations(), 1);
    await w.tick();
    assert.equal(w.invalidations(), 1);
  });

  it('hooks the pane and the /cmc command', () => {
    const hooked: string[] = [];
    register(((event: string, matcher: Record<string, string>) => {
      hooked.push(`${event} ${JSON.stringify(matcher)}`);
    }) as never);
    assert.deepEqual(hooked, ['command.run {"command":"cmc"}', `ui.render {"component":"Pane","requestId":"${PANE_ID}"}`]);
  });
});
