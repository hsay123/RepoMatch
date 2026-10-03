/**
 * httpError.js — one place that builds every error response.
 *
 * The API contract mandates `{ "error": string, "code": string }`. The React
 * frontend additionally prefers `data.message` when rendering a failure, and
 * falls back to generic copy when it is absent. Emitting `message` as well
 * means a real, actionable message ("Start Ollama and make sure gemma4:e2b is
 * installed.") reaches the user instead of "The matching request failed.",
 * while still satisfying the required shape.
 *
 * All three keys carry the same text, so any consumer reading any one of them
 * gets the right thing.
 */

/**
 * Send a JSON error in the standard envelope.
 *
 * @param {import('express').Response} res
 * @param {number} status  HTTP status code
 * @param {string} code    stable machine-readable code, e.g. INVALID_PROFILE
 * @param {string} message human-readable explanation
 */
export function sendError(res, status, code, message) {
  return res.status(status).json({ error: message, code, message });
}

export default { sendError };
