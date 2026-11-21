// cmc spike probe — throwaway. Author: Peterson Sena (r3v3rs3).
// One script for every hook event: logs what Claude Code sends and, when a
// trigger file is present, answers with the behaviour under test.
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = process.env.CMC_SPIKE_DIR || join(tmpdir(), 'cmc-spike');
mkdirSync(dir, { recursive: true });

const logFile = join(dir, 'probe.log');
const queueFile = join(dir, 'queue.txt');

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function takeTrigger(name) {
  const file = join(dir, name);
  if (!existsSync(file)) return null;
  const text = readFileSync(file, 'utf8').trim();
  rmSync(file);
  return text;
}

function log(entry) {
  appendFileSync(logFile, `${JSON.stringify({ t: new Date().toISOString(), ...entry })}\n`);
}

let input = {};
const raw = readStdin();
try {
  input = JSON.parse(raw);
} catch {
  log({ event: 'unparseable', raw: raw.slice(0, 200) });
  process.exit(0);
}

const event = input.hook_event_name;
const base = {
  event,
  session: input.session_id,
  env: {
    data: process.env.CLAUDE_PLUGIN_DATA ?? null,
    root: process.env.CLAUDE_PLUGIN_ROOT ?? null,
  },
};

if (event === 'UserPromptSubmit') {
  const prompt = String(input.prompt ?? '');
  const releaseNow = prompt.trim() === ';;now';
  const held = prompt.startsWith(';;') && !releaseNow;
  log({ ...base, prompt, held, releaseNow, keys: Object.keys(input) });
  if (releaseNow) {
    // Let the prompt through and attach the held messages as context.
    const queued = existsSync(queueFile) ? readFileSync(queueFile, 'utf8').trim() : '';
    if (queued) rmSync(queueFile);
    const numbered = (queued || '(no held messages)')
      .split('\n')
      .map((line, i) => `${i + 1}. ${line}`)
      .join('\n');
    // Wording variants under test: does the model act on released messages?
    const wording = {
      a: `[cmc] The user released their held messages with ";;now":
${numbered}`,
      b: queued,
      c: `The user typed ";;now" to release these held messages. Treat each line as a message from the user:
${queued}`,
    }[process.env.CMC_SPIKE_WORDING || 'c'];
    process.stdout.write(
      JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: wording } }),
    );
  } else if (held) {
    appendFileSync(queueFile, `${prompt.slice(2).trim()}\n`);
    process.stdout.write(JSON.stringify({ decision: 'block', reason: 'Held by cmc spike' }));
  }
} else if (event === 'PreToolUse') {
  log({ ...base, tool: input.tool_name, toolInput: input.tool_input });
} else if (event === 'PostToolUse') {
  const context = takeTrigger('post-context.txt');
  log({ ...base, tool: input.tool_name, injected: context });
  if (context) {
    process.stdout.write(
      JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context } }),
    );
  }
} else if (event === 'Stop') {
  const active = input.stop_hook_active === true;
  const reason = active ? null : takeTrigger('stop-block.txt');
  log({ ...base, stopHookActive: active, blockedWith: reason });
  if (reason) process.stdout.write(JSON.stringify({ decision: 'block', reason }));
} else {
  log({ ...base, keys: Object.keys(input) });
}
