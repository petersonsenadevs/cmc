// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// Types shared by the hook handlers, and the guard for what comes out of
// `JSON.parse`: everything read from stdin or from disk is untrusted.

/**
 * What Claude Code sends to a hook on stdin. Nothing in it is trusted: every
 * field is narrowed where it is used.
 */
export interface HookInput {
  session_id?: unknown;
  hook_event_name?: unknown;
  prompt?: unknown;
  cwd?: unknown;
  /** `SessionStart` only: `startup`, `resume`, `clear` or `compact`. */
  source?: unknown;
  /** `PreToolUse` and `PostToolUse` only: the tool the agent called. */
  tool_name?: unknown;
  /** `Stop` only: the turn is already continuing because of a Stop hook. */
  stop_hook_active?: unknown;
}

/** What the hook shell gives to every handler. */
export interface HookContext {
  /** Absolute path of the plugin data directory. */
  dataDir: string;
}

/** Whether a parsed JSON value is an object whose fields can be looked at. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
