// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// How dispatched agents are shown to the user: the receipt of a dispatch, the
// list of agents and what one of them has done so far.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUTPUT_FILE, type AgentRecord } from './agents-registry.ts';
import { errorCode } from './errors.ts';
import { isRecord } from './types.ts';

const TASK_PREVIEW = 70;
const LOG_ENTRIES = 12;
const LOG_ENTRY_LENGTH = 300;

function shorten(text: string, length: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}

/** "45s", "3m 05s", "1h 02m": how long an agent ran, or has been running. */
export function formatDuration(startedAt: string, endedAt: string | null, now: number = Date.now()): string {
  const start = Date.parse(startedAt);
  const end = endedAt === null ? now : Date.parse(endedAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return '?';
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** Where an agent works: its branch, or the folder it shares with the session. */
function workplace(agent: AgentRecord): string {
  if (agent.worktree === null) return 'same folder';
  const active = agent.state === 'starting' || agent.state === 'running';
  if (active || agent.branch) return `branch worktree-${agent.worktree}`;
  return 'no changes';
}

/**
 * What the user is told right after dispatching a task.
 */
export function dispatchReceipt(agent: AgentRecord): string {
  const context = agent.mode === 'fork' ? 'it inherits this conversation' : 'it gets a short summary of this conversation';
  const lines = [`Dispatched to agent ${agent.id}: ${context}. ";;agents" shows how it goes.`];
  lines.push(
    agent.worktree === null
      ? 'This folder is not a git repository, so the agent works in this same folder, next to the session.'
      : `It works in its own git worktree (branch worktree-${agent.worktree}).`,
  );
  lines.push(
    agent.returnMode === 'auto'
      ? 'When it ends, its result goes to this session by itself, at the end of a turn.'
      : 'When it ends, its result waits in the queue: ";;list" shows it, "/cmc:release" hands it over.',
  );
  if (agent.contextWarning) lines.push(`It starts knowing only the task: ${agent.contextWarning}`);
  return lines.join('\n');
}

/**
 * Lists the agents dispatched from a session, oldest first.
 */
export function formatAgents(agents: readonly AgentRecord[], now: number = Date.now()): string {
  if (agents.length === 0) return 'No agents have been dispatched from this session. Type ">> your task" to dispatch one.';
  const lines = agents.map((agent) => {
    const duration = formatDuration(agent.startedAt, agent.endedAt, now);
    return `${agent.id}  ${agent.state.padEnd(9)}  ${duration.padStart(7)}  ${workplace(agent)}  ${shorten(agent.task, TASK_PREVIEW)}`;
  });
  const noun = agents.length === 1 ? 'agent' : 'agents';
  return `${agents.length} dispatched ${noun}:\n${lines.join('\n')}`;
}

/** The readable steps of a stream-json log: what the agent said and which tools it called. */
function steps(file: string): string[] {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return [];
    throw error;
  }
  const found: string[] = [];
  for (const line of text.split('\n')) {
    if (!line.includes('"assistant"')) continue;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      continue; // A partial line at the end of a log that is still being written.
    }
    if (!isRecord(message) || message.type !== 'assistant' || !isRecord(message.message)) continue;
    const { content } = message.message;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') found.push(shorten(block.text, LOG_ENTRY_LENGTH));
      if (block.type === 'tool_use' && typeof block.name === 'string') {
        const input = isRecord(block.input) ? block.input : {};
        const target = input.file_path ?? input.command ?? input.pattern ?? '';
        found.push(shorten(`[${block.name}] ${typeof target === 'string' ? target : ''}`, LOG_ENTRY_LENGTH));
      }
    }
  }
  return found;
}

/**
 * What one agent was asked, how it stands and its latest steps or final answer.
 */
export function formatAgentLog(agent: AgentRecord, now: number = Date.now()): string {
  const lines = [
    `Agent ${agent.id} — ${agent.state}, ${formatDuration(agent.startedAt, agent.endedAt, now)}, ${workplace(agent)}`,
    `Task: ${agent.task}`,
  ];
  if (agent.changedFiles !== undefined && agent.changedFiles.length > 0) lines.push(`Changed files: ${agent.changedFiles.join(', ')}`);
  if (agent.worktreePath) lines.push(`Worktree: ${agent.worktreePath}`);

  const active = agent.state === 'starting' || agent.state === 'running';
  if (!active && agent.summary) {
    lines.push('', agent.state === 'finished' ? 'Its final answer:' : 'What went wrong:', agent.summary);
    return lines.join('\n');
  }
  const done = steps(join(agent.dir, OUTPUT_FILE));
  if (done.length === 0) lines.push('', active ? 'It has not reported any step yet.' : 'It left no output.');
  else lines.push('', `Latest steps (${Math.min(done.length, LOG_ENTRIES)} of ${done.length}):`, ...done.slice(-LOG_ENTRIES).map((step) => `- ${step}`));
  return lines.join('\n');
}
