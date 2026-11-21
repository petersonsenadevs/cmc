// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// One error type for everything the plugin can explain to the user.

export class CmcError extends Error {
  /** Stable identifier, e.g. `EMPTY_MESSAGE`. */
  code: string;

  /**
   * @param code Stable identifier, e.g. `EMPTY_MESSAGE`.
   * @param message Text that is safe to show to the user.
   */
  constructor(code: string, message: string) {
    super(message);
    this.name = 'CmcError';
    this.code = code;
  }
}

/**
 * The `code` of whatever was thrown (`ENOENT` from Node, `NO_SESSION` from
 * cmc), when it has one.
 */
export function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}
