// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// How the queue is shown to the user.
import type { HeldMessage } from './queue.ts';

const PREVIEW_LENGTH = 160;

function clock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--:--';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ');
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH - 1)}…` : flat;
}

/**
 * Lists the held messages in the exact order they will be delivered.
 */
export function formatQueue(messages: readonly HeldMessage[]): string {
  if (messages.length === 0) return 'No messages are held.';
  const lines = messages.map((message, index) => {
    const origin = message.source === 'user' ? '' : ` (from ${message.source})`;
    return `${index + 1}. [${clock(message.at)} · ${message.id}]${origin} ${preview(message.text)}`;
  });
  const noun = messages.length === 1 ? 'message' : 'messages';
  return `${messages.length} held ${noun}, in delivery order:\n${lines.join('\n')}`;
}
