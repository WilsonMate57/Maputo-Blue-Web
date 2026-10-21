// ─────────────────────────────────────────────────────────────────────────────
// errors.js — Typed application errors mapped to HTTP responses.
// `code` is a stable machine identifier the frontend translates (PT/EN).
// ─────────────────────────────────────────────────────────────────────────────

export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest   = (code, msg, details) => new AppError(400, code, msg, details);
export const unauthorized = (code = 'unauthenticated', msg = 'Authentication required') => new AppError(401, code, msg);
export const forbidden    = (code = 'forbidden', msg = 'Not allowed') => new AppError(403, code, msg);
export const notFound     = (code = 'not_found', msg = 'Not found') => new AppError(404, code, msg);
export const conflict     = (code, msg, details) => new AppError(409, code, msg, details);
