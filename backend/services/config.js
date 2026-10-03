/**
 * Centralised runtime configuration.
 *
 * Every tunable lives here so nothing is hardcoded in the middle of a service.
 *
 * IMPORTANT — why dotenv is loaded HERE rather than in server.js:
 * ES module `import` statements are hoisted and evaluated before ANY statement
 * in the importing module. So `import { config } from './config.js'` placed
 * above `dotenv.config()` in server.js still evaluates config.js first, which
 * reads process.env before .env has been parsed. That silently discarded
 * GITHUB_TOKEN (and any other non-default value). Loading dotenv at the top of
 * the module that reads process.env makes the order correct no matter how this
 * file is imported.
 */

import dotenv from 'dotenv';

dotenv.config();

/** Model id used for every /api/chat call. Spec: gemma4:e2b */
export const GEMMA_MODEL = process.env.GEMMA_MODEL || 'gemma4:e2b';

/** Ollama base URL, no trailing slash. */
export const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, '');

/** Port for the Express server. */
export const PORT = Number(process.env.PORT || 3000);

/** Origins allowed by CORS. The React dev server is the main one. */
export const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

/**
 * A GitHub token is OPTIONAL. Without one GitHub allows ~10 search requests/min
 * and a 60 req/hour hard cap, so we keep the number of calls minimal.
 */
export const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

/** In-memory cache lifetime for both search results and final responses. */
export const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** How many sequential Gemma calls we are willing to make for one request. */
export const MAX_ANALYZED_REPOS = 5;

/** Per-call timeout for one Gemma /api/chat request. */
export const GEMMA_TIMEOUT_MS = 90 * 1000; // 90 seconds

/** Timeout for the lightweight /api/tags health probe. */
export const OLLAMA_HEALTH_TIMEOUT_MS = 3000;

/** Hard cap on GitHub search calls per request (unauthenticated search is 10/min). */
export const MAX_SEARCH_CALLS = 3;

/** Cap on merged candidates handed to the deterministic pre-filter. */
export const MAX_CANDIDATES = 15;

/** Only the best N candidates get their good-first-issues fetched (saves API calls). */
export const MAX_ISSUE_FETCHES = 8;

/** Truncate issue bodies before they are sent to the model or to the client. */
export const MAX_ISSUE_BODY_CHARS = 400;
