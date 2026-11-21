// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Control words: what the user types right after the hold prefix (";;list",
// ";;move 3 1") to manage the queue. They are answered by the plugin itself,
// so nothing about them reaches the agent.
import { clearMessages, editMessage, listMessages, moveMessage, removeMessages, type QueueResult } from './queue.ts';
import { formatQueue } from './queue-view.ts';
import { arm, release, select } from './release.ts';

const POSITION = /^[1-9]\d{0,5}$/;

/**
 * A recognised control word with its arguments. Positions are the numbers the
 * user sees (1 = delivered first); how many there are depends on the word.
 */
export type Control =
  | { name: 'list' | 'help' | 'clear' }
  | { name: 'now' | 'end' | 'rm'; positions: number[] }
  | { name: 'up' | 'down' | 'top' | 'bottom'; positions: [number] }
  | { name: 'move'; positions: [number, number] }
  | { name: 'edit'; positions: [number]; text: string };

/**
 * What a control word answers: `reply` is shown to the user and the prompt
 * goes no further; `context` lets the prompt through and hands the text to
 * the agent with it.
 */
export type ControlAnswer = { reply: string } | { context: string };

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
  '  ;;dispatch N [--pack] [--auto]   hand held message N to a second agent instead',
  '  ;;agents          show the dispatched agents',
  '  ;;log ID          what an agent was asked and its latest steps or final answer',
  '  ;;cancel ID       stop an agent',
  '  ;;help            this list',
  'To hold a message, put a space after the prefix: ";; your message".',
  'To dispatch a task to a second agent: ">> your task". Add --pack for a short summary instead of the whole conversation,',
  'and --auto to get its result back by itself at the end of a turn instead of held in the queue.',
].join('\n');

const positions = (words: readonly string[]): number[] | null =>
  words.length > 0 && words.every((word) => POSITION.test(word)) ? words.map(Number) : null;

/**
 * Recognises a control word. The grammar is strict on purpose: anything that
 * does not match exactly is not a control word, and gets held as a message.
 * @param rest The prompt without the hold prefix.
 */
export function parseControl(rest: string): Control | null {
  // A space after the prefix always means "hold this".
  if (rest === '' || /^\s/.test(rest)) return null;

  const body = rest.trimEnd();
  const [name, ...words] = body.split(/\s+/);

  if (name === 'list' || name === 'help' || name === 'clear') return words.length === 0 ? { name } : null;

  if (name === 'now' || name === 'end') {
    if (words.length === 0) return { name, positions: [] };
    const list = positions(words);
    return list ? { name, positions: list } : null;
  }

  if (name === 'rm') {
    const list = positions(words);
    return list ? { name, positions: list } : null;
  }
  if (name === 'up' || name === 'down' || name === 'top' || name === 'bottom') {
    const [position, ...others] = positions(words) ?? [];
    return position !== undefined && others.length === 0 ? { name, positions: [position] } : null;
  }
  if (name === 'move') {
    const [from, to, ...others] = positions(words) ?? [];
    return from !== undefined && to !== undefined && others.length === 0 ? { name, positions: [from, to] } : null;
  }
  if (name === 'edit') {
    const [, position, text] = body.match(/^edit\s+([1-9]\d{0,5})\s+(\S[\s\S]*)$/) ?? [];
    return position !== undefined && text !== undefined ? { name, positions: [Number(position)], text } : null;
  }
  return null;
}

function withList(summary: string, result: QueueResult): string {
  const text = `${summary}\n${formatQueue(result.messages)}`;
  return result.warning ? `${text}\n${result.warning}` : text;
}

function relative(dir: string, from: number, offset: number): QueueResult {
  const { messages } = listMessages(dir);
  const to = Math.min(Math.max(from + offset, 1), Math.max(messages.length, 1));
  return moveMessage(dir, from, to);
}

/**
 * Runs a control word against the queue of one session.
 * @param dir Session folder.
 */
export function runControl(dir: string, control: Control): ControlAnswer {
  const answer = answerControl(dir, control);
  return typeof answer === 'string' ? { reply: answer } : answer;
}

function answerControl(dir: string, control: Control): string | { context: string } {
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
      // Someone else (the CLI, another hook) took the messages between the two steps.
      if (result.text === null) {
        const reply = 'Nothing is held, so there is nothing to release.';
        return result.warning ? `${reply}\n${result.warning}` : reply;
      }
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
    case 'edit': {
      const [position] = control.positions;
      return withList(`Message ${position} updated.`, editMessage(dir, position, control.text));
    }
    case 'move': {
      const [from, to] = control.positions;
      return withList(`Message ${from} moved to position ${to}.`, moveMessage(dir, from, to));
    }
    case 'up': {
      const [position] = control.positions;
      return withList(`Message ${position} moved up.`, relative(dir, position, -1));
    }
    case 'down': {
      const [position] = control.positions;
      return withList(`Message ${position} moved down.`, relative(dir, position, 1));
    }
    case 'top': {
      const [position] = control.positions;
      return withList(`Message ${position} is now first.`, moveMessage(dir, position, 1));
    }
    case 'bottom': {
      const [position] = control.positions;
      return withList(`Message ${position} is now last.`, relative(dir, position, Number.MAX_SAFE_INTEGER));
    }
    default: {
      // Every control word is handled above; this only runs for a value that got past the types.
      const unhandled: never = control;
      throw new Error(`unhandled control word: ${JSON.stringify(unhandled)}`);
    }
  }
}
