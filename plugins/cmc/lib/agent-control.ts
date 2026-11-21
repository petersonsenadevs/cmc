// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Dispatching from the prompt and the control words about dispatched agents
// (";;agents", ";;log 1a2b", ";;cancel 1a2b", ";;dispatch 2"). Like the queue
// control words, they are answered by the plugin: the agent of the session
// sees none of it.
import { findAgent, listAgents, type AgentMode, type ReturnMode } from './agents-registry.ts';
import { dispatchReceipt, formatAgentLog, formatAgents } from './agents-view.ts';
import { cancelAgent, dispatch, tellAgent } from './dispatch.ts';
import { EFFORTS, MODEL_NAME } from './config.ts';
import { CmcError } from './errors.ts';
import { drainMessages, listMessages } from './queue.ts';

const POSITION = /^[1-9]\d{0,5}$/;
const AGENT_ID = /^[a-f0-9]{2,8}$/;
const PACK_FLAG = '--pack';
const FORK_FLAG = '--fork';
const AUTO_FLAG = '--auto';
const HELD_FLAG = '--held';
const FLAGS: readonly string[] = [PACK_FLAG, FORK_FLAG, AUTO_FLAG, HELD_FLAG];

/** What a dispatch does when the user names no flag. */
export const DEFAULT_CHOICE: DispatchChoice = Object.freeze({ mode: 'fork', returnMode: 'held' });

/** `--model <name>` and `--effort <level>`, joined into one word each (`--model=<name>`). */
function joinValueFlags(words: readonly string[]): string[] | null {
  const joined: string[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i] ?? '';
    if (word === '--model' || word === '--effort') {
      const value = words[i + 1];
      if (value === undefined) return null;
      joined.push(`${word}=${value}`);
      i += 1;
    } else joined.push(word);
  }
  return joined;
}

/** Whether a word is a dispatch flag: a switch, or a valid --model= / --effort=. */
function isFlag(word: string): boolean {
  if (FLAGS.includes(word)) return true;
  if (word.startsWith('--model=')) return MODEL_NAME.test(word.slice('--model='.length));
  if (word.startsWith('--effort=')) return EFFORTS.includes(word.slice('--effort='.length));
  return false;
}

/** Applies flags to the defaults; a later flag wins over an earlier one. */
function choose(flags: readonly string[], defaults: DispatchChoice): DispatchChoice {
  let { mode, returnMode } = defaults;
  let { model, effort } = defaults;
  for (const flag of flags) {
    if (flag === PACK_FLAG) mode = 'pack';
    else if (flag === FORK_FLAG) mode = 'fork';
    else if (flag === AUTO_FLAG) returnMode = 'auto';
    else if (flag === HELD_FLAG) returnMode = 'held';
    else if (flag.startsWith('--model=')) model = flag.slice('--model='.length);
    else if (flag.startsWith('--effort=')) effort = flag.slice('--effort='.length);
  }
  return { mode, returnMode, ...(model === undefined ? {} : { model }), ...(effort === undefined ? {} : { effort }) };
}

/** How a dispatch was asked for: the context the agent gets and how its result comes back. */
export interface DispatchChoice {
  mode: AgentMode;
  returnMode: ReturnMode;
  /** For this agent only; absent: the settings. */
  model?: string;
  effort?: string;
}

/** The session a dispatch starts from. */
export interface DispatchOrigin {
  /** Session folder in the plugin data directory. */
  dir: string;
  sessionId: string;
  /** Folder the session works in. */
  cwd: string;
  transcriptPath?: string;
  /** Executable of Claude Code (and fixed leading arguments, in tests). */
  claude?: readonly string[];
  env?: NodeJS.ProcessEnv;
  /** From the settings: what the agent may do. */
  permissionMode?: string;
  tools?: readonly string[];
  restrictTools?: boolean;
  /** How long a subagent's session stays open after it answers, in ms. */
  keepOpenMs?: number;
  /** From the settings: the model and effort subagents run with. */
  model?: string;
  effort?: string;
}

export type AgentControl =
  | { name: 'agents' }
  | { name: 'log' | 'cancel'; id: string }
  | { name: 'tell'; id: string; text: string }
  | ({ name: 'dispatch'; position: number } & DispatchChoice);

/**
 * Recognises a control word about agents. As with the queue words the grammar
 * is strict: what does not match exactly is held as a message.
 * @param rest The prompt without the hold prefix.
 */
export function parseAgentControl(rest: string, defaults: DispatchChoice = DEFAULT_CHOICE): AgentControl | null {
  if (rest === '' || /^\s/.test(rest)) return null;
  const [name, ...words] = rest.trimEnd().split(/\s+/);
  const [first, second, ...more] = words;

  if (name === 'agents') return words.length === 0 ? { name } : null;
  if (name === 'tell') {
    // ;;tell <id> <message>: the message is everything after the id, as typed.
    const match = rest.match(/^tell\s+(\S+)\s+([\s\S]+)$/);
    return match && match[1] !== undefined && match[2] !== undefined && AGENT_ID.test(match[1]) ? { name, id: match[1], text: match[2].trim() } : null;
  }
  if (name === 'log' || name === 'cancel') {
    return first !== undefined && second === undefined && AGENT_ID.test(first) ? { name, id: first } : null;
  }
  if (name === 'dispatch') {
    if (first === undefined || !POSITION.test(first)) return null;
    const flags = joinValueFlags([second, ...more].filter((word): word is string => word !== undefined));
    if (flags === null) return null;
    const known = flags.every(isFlag) && new Set(flags).size === flags.length;
    if (!known) return null;
    return { name, position: Number(first), ...choose(flags, defaults) };
  }
  return null;
}

/**
 * Splits what follows the dispatch prefix into the task and how the agent
 * gets its context: `>> --pack task` asks for the short summary.
 */
export function parseDispatch(rest: string, defaults: DispatchChoice = DEFAULT_CHOICE): { task: string } & DispatchChoice {
  let text = rest.trim();
  const flags: string[] = [];
  // Flags come first, in any order: ">> --auto --pack task".
  for (;;) {
    const valued = text.match(/^--(model|effort)(?:=|\s+)(\S+)(?:\s+|$)/);
    if (valued) {
      const flag = `--${valued[1]}=${valued[2]}`;
      if (!isFlag(flag)) throw new CmcError('BAD_USAGE', valued[1] === 'model' ? `"${valued[2]}" is not a model name.` : `"${valued[2]}" is not an effort; use one of ${EFFORTS.join(', ')}.`);
      flags.push(flag);
      text = text.slice(valued[0].length).trim();
      continue;
    }
    const flag = FLAGS.find((candidate) => text === candidate || text.startsWith(`${candidate} `));
    if (flag === undefined) break;
    flags.push(flag);
    text = text.slice(flag.length).trim();
  }
  return { task: text, ...choose(flags, defaults) };
}

/**
 * Dispatches a task and returns what to tell the user.
 */
export function startAgent(origin: DispatchOrigin, task: string, { mode, returnMode, model, effort }: DispatchChoice): string {
  const chosenModel = model ?? origin.model;
  const chosenEffort = effort ?? origin.effort;
  const agent = dispatch({
    sessionDir: origin.dir,
    sessionId: origin.sessionId,
    task,
    cwd: origin.cwd,
    mode,
    returnMode,
    transcriptPath: origin.transcriptPath,
    ...(origin.claude === undefined ? {} : { claude: origin.claude }),
    ...(origin.env === undefined ? {} : { env: origin.env }),
    ...(origin.permissionMode === undefined ? {} : { permissionMode: origin.permissionMode }),
    ...(origin.tools === undefined ? {} : { tools: origin.tools }),
    ...(origin.restrictTools === undefined ? {} : { restrictTools: origin.restrictTools }),
    ...(origin.keepOpenMs === undefined ? {} : { keepOpenMs: origin.keepOpenMs }),
    ...(chosenModel === undefined ? {} : { model: chosenModel }),
    ...(chosenEffort === undefined ? {} : { effort: chosenEffort }),
  });
  return dispatchReceipt(agent);
}

/**
 * Runs a control word about agents and returns what to tell the user.
 */
export function runAgentControl(origin: DispatchOrigin, control: AgentControl): string {
  switch (control.name) {
    case 'agents':
      return formatAgents(listAgents(origin.dir));
    case 'log':
      return formatAgentLog(findAgent(origin.dir, control.id));
    case 'tell': {
      const agent = tellAgent(origin.dir, control.id, control.text, origin.env);
      return agent.state === 'starting' && agent.resumeCwd !== undefined
        ? `Agent ${agent.id} had closed its session; it is resumed with your message.`
        : `Sent to agent ${agent.id}${agent.state === 'running' ? ': it reads it after its current step' : ''}.`;
    }
    case 'cancel': {
      const agent = cancelAgent(origin.dir, control.id);
      const left = agent.worktreePath ? ` Its work so far is kept in ${agent.worktreePath}.` : '';
      return `Agent ${agent.id} cancelled.${left}`;
    }
    case 'dispatch': {
      // The held message leaves the queue only once the agent has been started.
      const { messages } = listMessages(origin.dir);
      const message = messages[control.position - 1];
      if (message === undefined) {
        const size = messages.length === 0 ? 'nothing is held' : `the queue has ${messages.length}`;
        throw new CmcError('NO_SUCH_MESSAGE', `There is no held message ${control.position} (${size}).`);
      }
      const receipt = startAgent(origin, message.text, control);
      drainMessages(origin.dir, [message.id]);
      return `Held message ${control.position} left the queue. ${receipt}`;
    }
  }
}
