// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// The user's settings: a JSON file in the plugin data directory. Every value is
// validated; one that is missing or wrong falls back to its default, and the
// problem is reported instead of stopping the plugin.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentMode, ReturnMode } from './agents-registry.ts';
import { writeFileAtomic } from './atomic-write.ts';
import { errorCode } from './errors.ts';
import { isRecord } from './types.ts';

export const CONFIG_FILE = 'config.json';

/** Permission modes a dispatched agent may run with; `bypassPermissions` is never one of them. */
export const PERMISSION_MODES: readonly string[] = Object.freeze(['default', 'acceptEdits', 'plan']);
/** A tool name as Claude Code's `--allowedTools` takes it, optionally with a rule: `Bash(npm test:*)`. */
// No comma inside the rule: Claude Code splits the list on commas.
export const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_]*(\([^(),]*\))?$/;

export interface DispatchSettings {
  /** How a dispatched agent gets its context unless the user says otherwise. */
  context: AgentMode;
  /** How its result comes back unless the user says otherwise. */
  return: ReturnMode;
  permissionMode: string;
  tools: readonly string[];
  /**
   * Whether the agent has only the built-in tools in `tools` (true), or every
   * built-in tool with `tools` merely pre-approved (false). Restricting changes
   * the agent's prompt, so a fork no longer reuses the session's prompt cache
   * and costs much more.
   */
  restrictTools: boolean;
}

export interface CmcConfig {
  /** Starts a message to hold, and the control words. */
  holdPrefix: string;
  /** Starts a task for a second agent. */
  dispatchPrefix: string;
  dispatch: DispatchSettings;
  /**
   * Messages held while the agent works go to it by themselves when its turn
   * ends. `false`: they stay held until the user sends them.
   */
  sendAtEnd: boolean;
  /** Sessions inactive for longer are deleted with their queue; 0 keeps them forever. */
  retentionDays: number;
}

export const DEFAULT_CONFIG: CmcConfig = Object.freeze({
  holdPrefix: ';;',
  dispatchPrefix: '>>',
  sendAtEnd: true,
  dispatch: Object.freeze({
    context: 'fork',
    return: 'held',
    permissionMode: 'acceptEdits',
    tools: Object.freeze(['Read', 'Glob', 'Grep', 'Edit', 'Write']),
    restrictTools: true,
  }),
  retentionDays: 30,
}) as CmcConfig;

/** The settings in force, and what was wrong with the file, if anything. */
export interface LoadedConfig {
  config: CmcConfig;
  /** One line per value that was ignored. Empty when the file is fine or absent. */
  warnings: string[];
  /** Where the file is (or would be). */
  path: string;
}

const PREFIX = /^[^\sA-Za-z0-9/]{1,4}$/;

function prefixProblem(value: unknown): string | null {
  if (typeof value !== 'string') return 'it must be text';
  if (!PREFIX.test(value)) return 'it must be 1 to 4 symbols, without spaces, letters, digits or "/"';
  return null;
}

/**
 * Validates parsed settings. Unknown keys are reported and ignored, so a typo
 * does not pass unnoticed.
 */
export function validateConfig(raw: unknown): { config: CmcConfig; warnings: string[] } {
  const warnings: string[] = [];
  const config: CmcConfig = { ...DEFAULT_CONFIG, dispatch: { ...DEFAULT_CONFIG.dispatch } };
  if (!isRecord(raw) || Array.isArray(raw)) return { config, warnings: ['the file must hold a JSON object; using the defaults'] };

  const ignored = (key: string, why: string) => warnings.push(`"${key}" ignored: ${why}; using the default`);
  const known = new Set(['holdPrefix', 'dispatchPrefix', 'sendAtEnd', 'dispatch', 'retentionDays']);
  for (const key of Object.keys(raw)) if (!known.has(key) && !key.startsWith('$')) warnings.push(`unknown setting "${key}" ignored`);

  for (const key of ['holdPrefix', 'dispatchPrefix'] as const) {
    if (raw[key] === undefined) continue;
    const problem = prefixProblem(raw[key]);
    if (problem === null) config[key] = String(raw[key]);
    else ignored(key, problem);
  }
  // Two prefixes where one starts the other would make some prompts ambiguous.
  if (config.holdPrefix.startsWith(config.dispatchPrefix) || config.dispatchPrefix.startsWith(config.holdPrefix)) {
    warnings.push(`"holdPrefix" and "dispatchPrefix" overlap ("${config.holdPrefix}", "${config.dispatchPrefix}"); using the defaults for both`);
    config.holdPrefix = DEFAULT_CONFIG.holdPrefix;
    config.dispatchPrefix = DEFAULT_CONFIG.dispatchPrefix;
  }

  if (raw.sendAtEnd !== undefined) {
    if (typeof raw.sendAtEnd === 'boolean') config.sendAtEnd = raw.sendAtEnd;
    else ignored('sendAtEnd', 'it must be true or false');
  }

  if (raw.retentionDays !== undefined) {
    const days = raw.retentionDays;
    if (typeof days === 'number' && Number.isInteger(days) && days >= 0 && days <= 3650) config.retentionDays = days;
    else ignored('retentionDays', 'it must be a whole number of days from 0 to 3650');
  }

  if (raw.dispatch !== undefined) {
    const dispatch = raw.dispatch;
    if (!isRecord(dispatch) || Array.isArray(dispatch)) ignored('dispatch', 'it must be an object');
    else {
      const knownDispatch = new Set(['context', 'return', 'permissionMode', 'tools', 'restrictTools']);
      for (const key of Object.keys(dispatch)) if (!knownDispatch.has(key)) warnings.push(`unknown setting "dispatch.${key}" ignored`);
      if (dispatch.context !== undefined) {
        if (dispatch.context === 'fork' || dispatch.context === 'pack') config.dispatch.context = dispatch.context;
        else ignored('dispatch.context', 'it must be "fork" or "pack"');
      }
      if (dispatch.return !== undefined) {
        if (dispatch.return === 'held' || dispatch.return === 'auto') config.dispatch.return = dispatch.return;
        else ignored('dispatch.return', 'it must be "held" or "auto"');
      }
      if (dispatch.permissionMode !== undefined) {
        const mode = dispatch.permissionMode;
        if (typeof mode === 'string' && PERMISSION_MODES.includes(mode)) config.dispatch.permissionMode = mode;
        else ignored('dispatch.permissionMode', `it must be one of ${PERMISSION_MODES.map((m) => `"${m}"`).join(', ')}`);
      }
      if (dispatch.tools !== undefined) {
        const tools = dispatch.tools;
        const valid = Array.isArray(tools) && tools.length <= 50 && tools.every((tool): tool is string => typeof tool === 'string' && TOOL_NAME.test(tool));
        if (valid) config.dispatch.tools = Object.freeze([...tools]);
        else ignored('dispatch.tools', 'it must be a list of tool names such as "Read" or "Bash(npm test:*)"');
      }
      if (dispatch.restrictTools !== undefined) {
        if (typeof dispatch.restrictTools === 'boolean') config.dispatch.restrictTools = dispatch.restrictTools;
        else ignored('dispatch.restrictTools', 'it must be true or false');
      }
    }
  }
  return { config, warnings };
}

/**
 * Reads the settings of a data directory. Never throws for a bad or missing
 * file: the defaults apply and the problem is in `warnings`.
 */
export function loadConfig(dataDir: string | undefined): LoadedConfig {
  const path = join(dataDir ?? '', CONFIG_FILE);
  if (dataDir === undefined || !existsSync(path)) return { config: DEFAULT_CONFIG, warnings: [], path };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    const why = error instanceof SyntaxError ? `it is not valid JSON (${error.message})` : `it cannot be read (${errorCode(error) ?? 'unknown error'})`;
    return { config: DEFAULT_CONFIG, warnings: [`${CONFIG_FILE} ignored: ${why}; using the defaults`], path };
  }
  return { ...validateConfig(raw), path };
}

/** Writes a settings file with every value at its default, for the user to edit. */
export function writeDefaultConfig(dataDir: string): string {
  const path = join(dataDir, CONFIG_FILE);
  writeFileAtomic(path, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
  return path;
}

/**
 * Rewrites cmc's own help and hints for the prefixes in force. Only for text
 * cmc writes: never for text that contains what the user typed.
 */
export function withPrefixes(text: string, config: CmcConfig): string {
  return text.split(';;').join(config.holdPrefix).split('>>').join(config.dispatchPrefix);
}
