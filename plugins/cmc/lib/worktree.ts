// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Isolation of a dispatched agent: it works in its own git worktree, created
// by Claude Code's `--worktree` flag (ADR 002), so two agents never edit the
// same files at once. This module names the worktree, finds it afterwards,
// tells whether the agent changed anything and removes it when it did not.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { isAlive } from './agents-registry.ts';

/** What became of an agent's worktree once the agent ended. */
export interface WorktreeOutcome {
  /** Folder of the worktree, or `null` when it is gone or was never created. */
  path: string | null;
  branch: string;
  /** Files the agent changed, committed or not. */
  files: string[];
  /** Whether the worktree was left in place. */
  kept: boolean;
}

/** A worktree as git lists it. */
export interface WorktreeEntry {
  path: string;
  /** Why it is locked, `''` for a lock without a reason, `null` when it is not locked. */
  lockReason: string | null;
}

// The separator of git's `-z` output, built from its code so that this source
// file never holds the character itself.
const NUL = String.fromCharCode(0);

/** Runs git with an argument array; never through a shell. */
function git(cwd: string, args: string[]): { ok: boolean; out: string } {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  return { ok: result.status === 0, out: (result.stdout ?? '').trim() };
}

/**
 * Runs a git command that lists paths with `-z` and returns its entries.
 * With `-z` git separates entries with NUL and prints every path as it is:
 * no quoting of names with spaces or accents, and no line ending to guess.
 */
function gitEntries(cwd: string, args: string[]): string[] {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) return [];
  return (result.stdout ?? '').split(NUL).filter((entry) => entry !== '');
}

/** Whether the folder is inside a git work tree. */
export function isGitRepo(cwd: string): boolean {
  const result = git(cwd, ['rev-parse', '--is-inside-work-tree']);
  return result.ok && result.out === 'true';
}

/** The commit the folder is on, if it has one. */
export function headCommit(cwd: string): string | null {
  const result = git(cwd, ['rev-parse', '--verify', 'HEAD']);
  return result.ok && result.out !== '' ? result.out : null;
}

/** The worktree name cmc gives to an agent. */
export function worktreeName(agentId: string): string {
  return `cmc-${agentId}`;
}

/** The branch Claude Code creates for a worktree of that name. */
export function worktreeBranch(name: string): string {
  return `worktree-${name}`;
}

/**
 * Finds a worktree by the branch it is on.
 * @param cwd Any folder of the repository.
 */
export function findWorktreeEntry(cwd: string, name: string): WorktreeEntry | null {
  const listing = git(cwd, ['worktree', 'list', '--porcelain']);
  if (!listing.ok) return null;
  const wanted = `branch refs/heads/${worktreeBranch(name)}`;
  // Entries are separated by a blank line; each starts with "worktree <path>".
  for (const entry of listing.out.split(/\r?\n\r?\n/)) {
    const [first, ...rest] = entry.split(/\r?\n/);
    if (first === undefined || !rest.includes(wanted)) continue;
    const lock = rest.find((line) => line === 'locked' || line.startsWith('locked '));
    return { path: resolve(first.replace(/^worktree /, '')), lockReason: lock === undefined ? null : lock.slice('locked '.length) };
  }
  return null;
}

/**
 * Finds the folder of a worktree by the branch it is on.
 * @param cwd Any folder of the repository.
 */
export function findWorktree(cwd: string, name: string): string | null {
  return findWorktreeEntry(cwd, name)?.path ?? null;
}

/**
 * Whether a lock is the one Claude Code put on this worktree for a session
 * that is no longer running. Claude Code locks the worktree of a session
 * ("claude session <name> (pid <n>)") and leaves the lock behind when the
 * session ends. Any other lock is someone else's and is left alone.
 */
export function isStaleSessionLock(lockReason: string | null, name: string): boolean {
  if (lockReason === null) return false;
  const match = lockReason.match(/^claude session (\S+) \(pid (\d+)\)$/);
  return match !== null && match[1] === name && !isAlive(Number(match[2]));
}

/**
 * What an agent left in its worktree.
 * @param baseCommit Commit the repository was on when the agent started.
 * @returns Files changed, committed or not; empty when it changed nothing.
 */
export function changedFiles(path: string, baseCommit: string | null): string[] {
  const files = new Set<string>();
  // Each entry is two status characters, a space and the path. A rename or a
  // copy is followed by one more entry, the path it came from, which is skipped.
  const status = gitEntries(path, ['status', '--porcelain', '-z']);
  for (let i = 0; i < status.length; i += 1) {
    const entry = status[i] ?? '';
    files.add(entry.slice(3));
    if (entry.startsWith('R') || entry.startsWith('C')) i += 1;
  }
  if (baseCommit !== null) {
    for (const file of gitEntries(path, ['diff', '--name-only', '-z', baseCommit, 'HEAD'])) files.add(file);
  }
  return [...files].sort();
}

/**
 * Settles the worktree of an agent that has ended: removed with its branch
 * when nothing changed, kept (and described) when there is work in it. The
 * lock its finished session left behind is lifted either way, so the user can
 * merge or remove a kept worktree with plain git.
 * @param cwd Folder the agent was started in.
 */
export function settleWorktree(cwd: string, name: string, baseCommit: string | null): WorktreeOutcome {
  const branch = worktreeBranch(name);
  const entry = findWorktreeEntry(cwd, name);
  if (entry === null) return { path: null, branch, files: [], kept: false };

  const { path } = entry;
  if (isStaleSessionLock(entry.lockReason, name)) git(cwd, ['worktree', 'unlock', path]);

  const files = changedFiles(path, baseCommit);
  if (files.length > 0) return { path, branch, files, kept: true };

  // Nothing to lose: without --force git refuses to remove a worktree that has
  // changes or is still locked, and `branch -d` refuses a branch with commits
  // that are not merged.
  const removed = git(cwd, ['worktree', 'remove', path]);
  if (removed.ok) git(cwd, ['branch', '-d', branch]);
  return { path: removed.ok ? null : path, branch, files, kept: !removed.ok };
}
