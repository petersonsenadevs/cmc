// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Control words: what the user types right after the hold prefix (";;list",
// ";;move 3 1") to manage the queue. They are answered by the plugin itself,
// so nothing about them reaches the agent.
import { clearMessages, editMessage, listMessages, moveMessage, removeMessages } from './queue.ts';
import { formatQueue } from './queue-view.ts';
import { arm, release, select } from './release.ts';

const POSITION = /^[1-9]\d{0,5}$/;

export const CONTROL_HELP = [
  'cmc control words (type them right after the prefix, no space):',
  '  ;;list            show the held messages',
  '  ;;edit N text     replace the text of message N',
  '  ;;rm N [N…]       delete messages',
  '  ;;clear           delete every held message',
  '  ;;move N M        move message N to position M',
  '  ;;up N  ;;down N  move message N one place',
  '  ;;top N  ;;bottom N   make message N the first or the last to be delivered',
  '  ;;now [N…]        release now: everything, or only those messages',
  '  ;;end [N…]        release when this turn ends: everything, or only those messages',
  '  ;;help            this list',
  'To hold a message, put a space after the prefix: ";; your message".',
].join('\n');

const positions = (words) => (words.length > 0 && words.every((word) => POSITION.test(word)) ? words.map(Number) : null);

/**
 * Recognises a control word. The grammar is strict on purpose: anything that
 * does not match exactly is not a control word, and gets held as a message.
 * @param {string} rest The prompt without the hold prefix.
 * @returns {{ name: string, positions?: number[], text?: string } | null}
 */
export function parseControl(rest) {
  // A space after the prefix always means "hold this".
  if (rest === '' || /^\s/.test(rest)) return null;

  const body = rest.trimEnd();
  const [name, ...words] = body.split(/\s+/);

  if (['list', 'help', 'clear'].includes(name)) return words.length === 0 ? { name } : null;

  if (name === 'now' || name === 'end') {
    if (words.length === 0) return { name, positions: [] };
    const list = positions(words);
    return list ? { name, positions: list } : null;
  }

  if (name === 'rm') {
    const list = positions(words);
    return list ? { name, positions: list } : null;
  }
  if (['up', 'down', 'top', 'bottom'].includes(name)) {
    const list = positions(words);
    return list?.length === 1 ? { name, positions: list } : null;
  }
  if (name === 'move') {
    const list = positions(words);
    return list?.length === 2 ? { name, positions: list } : null;
  }
  if (name === 'edit') {
    const match = body.match(/^edit\s+([1-9]\d{0,5})\s+(\S[\s\S]*)$/);
    return match ? { name, positions: [Number(match[1])], text: match[2] } : null;
  }
  return null;
}

function withList(summary, result) {
  const text = `${summary}\n${formatQueue(result.messages)}`;
  return result.warning ? `${text}\n${result.warning}` : text;
}

function relative(dir, from, offset) {
  const { messages } = listMessages(dir);
  const to = Math.min(Math.max(from + offset, 1), Math.max(messages.length, 1));
  return moveMessage(dir, from, to);
}

/**
 * Runs a control word against the queue of one session.
 * @param {string} dir Session folder.
 * @param {NonNullable<ReturnType<typeof parseControl>>} control
 * @returns {{ reply: string } | { context: string }} `reply` is shown to the user and the prompt goes no
 *   further; `context` lets the prompt through and hands the text to the agent with it.
 */
export function runControl(dir, control) {
  const answer = answerControl(dir, control);
  return typeof answer === 'string' ? { reply: answer } : answer;
}

function answerControl(dir, control) {
  const [first, second] = control.positions ?? [];
  switch (control.name) {
    case 'help':
      return CONTROL_HELP;
    case 'list': {
      const result = listMessages(dir);
      return result.warning ? `${formatQueue(result.messages)}\n${result.warning}` : formatQueue(result.messages);
    }
    case 'now': {
      const { selection, held } = select(dir, control.positions);
      if (held === 0) return 'Nothing is held, so there is nothing to release.';
      const result = release(dir, selection, ';;now');
      // The text is handed to the agent together with the ";;now" prompt itself.
      return { context: result.warning ? `${result.text}\n\n[cmc] ${result.warning}` : result.text };
    }
    case 'end': {
      const { selection, count, held } = select(dir, control.positions);
      arm(dir, 'atEnd', selection);
      if (held === 0) return 'Nothing is held yet. Whatever you hold next will be released when this turn ends.';
      return `${count} held message(s) will be released when this turn ends.`;
    }
    case 'clear': {
      const result = clearMessages(dir);
      return `Deleted ${result.removed.length} held message(s). The queue is empty.`;
    }
    case 'rm': {
      const result = removeMessages(dir, control.positions);
      return withList(`Deleted ${result.removed.length} held message(s).`, result);
    }
    case 'edit':
      return withList(`Message ${first} updated.`, editMessage(dir, first, control.text));
    case 'move':
      return withList(`Message ${first} moved to position ${second}.`, moveMessage(dir, first, second));
    case 'up':
      return withList(`Message ${first} moved up.`, relative(dir, first, -1));
    case 'down':
      return withList(`Message ${first} moved down.`, relative(dir, first, 1));
    case 'top':
      return withList(`Message ${first} is now first.`, moveMessage(dir, first, 1));
    case 'bottom':
      return withList(`Message ${first} is now last.`, relative(dir, first, Number.MAX_SAFE_INTEGER));
    default:
      throw new Error(`unhandled control word: ${control.name}`);
  }
}
