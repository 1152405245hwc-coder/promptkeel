/**
 * Stable error codes are part of the CLI contract: agents and scripts branch on
 * `code`, never on the human message. Keep this list small and documented.
 */
export class ForgeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ForgeError";
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return { ok: false, code: this.code, error: this.message, details: this.details };
  }
}

export function fail(code, message, details = {}) {
  throw new ForgeError(code, message, details);
}

export function assert(condition, code, message, details = {}) {
  if (!condition) fail(code, message, details);
}
