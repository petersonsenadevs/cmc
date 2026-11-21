// cmc — test helper: a separate process that adds to or drains a queue. Author: Peterson Sena (r3v3rs3).
//   node queue-worker.mjs add <dir> <count> <label>
//   node queue-worker.mjs drain <dir> <stopFile>
import { existsSync } from 'node:fs';
import { addMessage, drainMessages } from '../lib/queue.mjs';

const [mode, dir, third, label] = process.argv.slice(2);

if (mode === 'add') {
  for (let i = 0; i < Number(third); i += 1) addMessage(dir, { text: `${label}-${i}` });
} else {
  const texts = [];
  // Keep draining until the writers are done and the queue is empty.
  for (;;) {
    const writersDone = existsSync(third);
    const { messages } = drainMessages(dir);
    texts.push(...messages.map((message) => message.text));
    if (writersDone && messages.length === 0) break;
  }
  process.stdout.write(JSON.stringify(texts));
}
