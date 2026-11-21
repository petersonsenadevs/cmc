// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// What a dispatched agent leaves for the session that dispatched it: once it
// has ended, its result goes into that session's queue as a held message,
// marked as coming from the agent. The user decides when the session sees it;
// with `>> --auto` it is handed over by itself when a turn of the session ends.
import { dirname, join } from 'node:path';
import { OUTPUT_FILE, updateAgentAt, type AgentRecord } from './agents-registry.ts';
import { addMessage, MAX_TEXT_LENGTH } from './queue.ts';
import { mergeSelection, updateStateWith } from './session-state.ts';

const TASK_PREVIEW = 200;

/** The `source` of a held message that a dispatched agent left. */
export function agentSource(agentId: string): string {
  return `agent ${agentId}`;
}

/** The id of the agent that left a held message, or `null` for one the user typed. */
export function agentOf(source: string): string | null {
  const match = source.match(/^agent ([a-f0-9]{8})$/);
  return match?.[1] ?? null;
}

function shorten(text: string, length: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}

/**
 * The held message that reports how an agent ended: what it was asked, where
 * its work is and what it answered, or why it failed and where its log is.
 */
export function resultText(agent: AgentRecord): string {
  const task = shorten(agent.task, TASK_PREVIEW);
  const lines: string[] = [];
  if (agent.state === 'finished') {
    lines.push(`Agent ${agent.id} finished the task "${task}".`);
    if (agent.worktree === null) lines.push('It worked in the folder of the session.');
    else if (agent.changedFiles !== undefined && agent.changedFiles.length > 0) {
      lines.push(`Its changes are on the branch ${agent.branch ?? `worktree-${agent.worktree}`}: ${agent.changedFiles.join(', ')}.`);
      if (agent.worktreePath) lines.push(`Worktree: ${agent.worktreePath}`);
    } else lines.push('It changed no files.');
    lines.push('', 'Its final answer:', agent.summary ?? '(none)');
  } else {
    lines.push(`Agent ${agent.id} failed on the task "${task}".`, '', agent.summary ?? '(no reason recorded)', '', `Log: ${join(agent.dir, OUTPUT_FILE)}`);
    if (agent.worktreePath) lines.push(`Worktree: ${agent.worktreePath}`);
  }
  const text = lines.join('\n');
  // The answer was cut to fit already; this only guards the queue's own limit.
  return text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH - 1)}…` : text;
}

/**
 * Puts the result of an agent that has ended into the queue of its session,
 * and arms its automatic return when the agent was dispatched with `--auto`.
 * A cancelled agent leaves nothing: the user already decided about it.
 * @param agent The record as the supervisor left it, worktree settled.
 * @returns The record with the id of the held message.
 */
export function returnResult(agent: AgentRecord): AgentRecord {
  if (agent.state !== 'finished' && agent.state !== 'failed') return agent;
  // The agent folder is <session>/agents/<id>.
  const session = dirname(dirname(agent.dir));
  const { message } = addMessage(session, { text: resultText(agent), source: agentSource(agent.id) });
  if (agent.returnMode === 'auto') {
    updateStateWith(session, (state) => ({ autoReturn: mergeSelection(state.autoReturn, [message.id]) }));
  }
  return updateAgentAt(agent.dir, { resultMessageId: message.id });
}
