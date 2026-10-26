/** Structured application errors with stable machine-readable codes. */
export class AppError extends Error {
  /**
   * @param {string} code    stable error code, e.g. E_UNSUPPORTED_HOST
   * @param {string} message human-readable, safe to show to users
   * @param {object} [opts]  { status, details, cause }
   */
  constructor(code, message, opts = {}) {
    super(message, opts.cause ? { cause: opts.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.status = opts.status ?? 500;
    this.details = opts.details;
  }

  toJSON() {
    return {
      ok: false,
      error: { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) },
    };
  }
}

export const err = (code, message, opts) => new AppError(code, message, opts);
