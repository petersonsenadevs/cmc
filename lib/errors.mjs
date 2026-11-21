// cmc — Claude Message Control. Author: Peterson Sena (r3v3rs3).
// One error type for everything the plugin can explain to the user.

export class CmcError extends Error {
  /**
   * @param {string} code Stable identifier, e.g. `EMPTY_MESSAGE`.
   * @param {string} message Text that is safe to show to the user.
   */
  constructor(code, message) {
    super(message);
    this.name = 'CmcError';
    this.code = code;
  }
}
