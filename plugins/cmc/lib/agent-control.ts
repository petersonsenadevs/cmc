// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Dispatching from the prompt and the control words about dispatched agents
// (";;agents", ";;log 1a2b", ";;cancel 1a2b", ";;dispatch 2"). Like the queue
// control words, they are answered by the plugin: the agent of the session
// sees none of it.
import { findAgent, listAgents, type AgentMode } from './agents-registry.ts';
import { dispatchReceipt, formatAgentLog, formatAgents } from './agents-view.ts';
import { cancelAgent, dispatch } from './dispatch.ts';
import { CmcError } from './errors.ts';
import { drainMessages, listMessages } from './queue.ts';

const POSITION = /^[1-9]\d{0,5}$/;
const AGENT_ID = /^[a-f0-9]{2,8}$/;
const PACK_FLAG = '--pack';

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
}

export type AgentControl =
  | { name: 'agents' }
  | { name: 'log' | 'cancel'; id: string }
  | { name: 'dispatch'; position: number; mode: AgentMode };

/**
 * Recognises a control word about agents. As with the queue words the grammar
 * is strict: what does not match exactly is held as a message.
 * @param rest The prompt without the hold prefix.
 */
export function parseAgentControl(rest: string): AgentControl | null {
  if (rest === '' || /^\s/.test(rest)) return null;
  const [name, ...words] = rest.trimEnd().split(/\s+/);
  const [first, second, ...more] = words;

  if (name === 'agents') return words.length === 0 ? { name } : null;
  if (name === 'log' || name === 'cancel') {
    return first !== undefined && second === undefined && AGENT_ID.test(first) ? { name, id: first } : null;
  }
  if (name === 'dispatch') {
    if (first === undefined || !POSITION.test(first) || more.length > 0) return null;
    if (second !== undefined && second !== PACK_FLAG) return null;
    return { name, position: Number(first), mode: second === PACK_FLAG ? 'pack' : 'fork' };
  }
  return null;
}

/**
 * Splits what follows the dispatch prefix into the task and how the agent
 * gets its context: `>> --pack task` asks for the short summary.
 */
export function parseDispatch(rest: string): { task: string; mode: AgentMode } {
  const text = rest.trim();
  if (text === PACK_FLAG || text.startsWith(`${PACK_FLAG} `)) return { task: text.slice(PACK_FLAG.length).trim(), mode: 'pack' };
  return { task: text, mode: 'fork' };
}

/**
 * Dispatches a task and returns what to tell the user.
 */
export function startAgent(origin: DispatchOrigin, task: string, mode: AgentMode): string {
  const agent = dispatch({
    sessionDir: origin.dir,
    sessionId: origin.sessionId,
    task,
    cwd: origin.cwd,
    mode,
    transcriptPath: origin.transcriptPath,
    ...(origin.claude === undefined ? {} : { claude: origin.claude }),
    ...(origin.env === undefined ? {} : { env: origin.env }),
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
      const receipt = startAgent(origin, message.text, control.mode);
      drainMessages(origin.dir, [message.id]);
      return `Held message ${control.position} left the queue. ${receipt}`;
    }
  }
}
