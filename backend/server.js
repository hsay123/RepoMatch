/**
 * server.js — RepoMatch backend entry point.
 *
 *   npm install
 *   cp .env.example .env
 *   npm run dev
 *
 * Routes:
 *   GET  /api/health   liveness + Gemma/Ollama status
 *   POST /api/matches  the Tinder-style matching pipeline
 *   DELETE /api/cache  clear the in-memory caches (handy during development)
 */

import express from 'express';
import cors from 'cors';

// NOTE: .env is loaded inside services/config.js, not here. ES module imports
// are hoisted, so calling dotenv.config() in this file body would still run
// AFTER config.js had already read process.env — silently discarding every
// non-default value such as GITHUB_TOKEN. See the comment in config.js.
import { PORT, CORS_ORIGINS, GITHUB_TOKEN, GEMMA_MODEL, OLLAMA_URL, MAX_ANALYZED_REPOS } from './services/config.js';
import { checkGemma, GEMMA_UNAVAILABLE_MESSAGE } from './services/gemmaService.js';
import { sendError } from './services/httpError.js';
import {
  GITHUB_RATE_LIMIT_MESSAGE,
  GITHUB_UNAVAILABLE_MESSAGE,
} from './routes/matchRoutes.js';
import matchRoutes from './routes/matchRoutes.js';

const app = express();

/* ------------------------------------------------------------------ *
 * Middleware
 * ------------------------------------------------------------------ */

/**
 * CORS. Allows the Vite dev server (localhost:5173) plus anything listed in
 * CORS_ORIGINS. Requests with no Origin header (curl, server-to-server) are
 * always allowed, which is why the origin callback returns `true` for them.
 */
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (CORS_ORIGINS.includes(origin)) return callback(null, true);
      // Allow any localhost port so a teammate running Vite on 5174 still works.
      if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return callback(null, true);
      console.warn(`[cors] blocked origin: ${origin}`);
      return callback(null, false);
    },
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  })
);

app.use(express.json({ limit: '256kb' }));

// Log every request with its duration and status.
app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - started;
    const tag = res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN' : 'OK';
    console.log(`[http] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms) ${tag}`);
  });
  next();
});

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */

/**
 * GET /api/health
 * -> { status, gemma, ollama, model }
 *
 * `gemma` is true only when Ollama answers GET /api/tags AND that list
 * contains a model whose name starts with the configured model id.
 */
app.get('/api/health', async (_req, res) => {
  const health = await checkGemma();
  res.status(200).json({
    status: 'ok',
    gemma: Boolean(health.ollama && health.gemma),
    ollama: Boolean(health.ollama),
    model: health.model || GEMMA_MODEL,
  });
});

/** GET / -> tiny index so hitting the root in a browser is not confusing. */
app.get('/', (_req, res) => {
  res.json({
    name: 'RepoMatch API',
    version: '1.0.0',
    endpoints: {
      health: 'GET /api/health',
      matches: 'POST /api/matches',
      clearCache: 'DELETE /api/cache',
    },
    example: {
      method: 'POST /api/matches',
      body: { skills: ['React', 'JavaScript', 'Node.js'], interests: ['AI', 'Web Development'], experience: 'intermediate' },
    },
  });
});

// All real /api routes. Mounted at /api, so the router declares "/matches".
// This MUST be registered BEFORE the 404 catch-all below.
app.use('/api', matchRoutes);

// Anything else under /api is a 404, in the standard error envelope.
app.use('/api', (_req, res) => {
  sendError(res, 404, 'NOT_FOUND', 'Endpoint not found.');
});

/* ------------------------------------------------------------------ *
 * Central error handler
 * ------------------------------------------------------------------ */

/** Anything thrown that is not an explicit `next(err)` lands here. */
app.use((err, req, res, _next) => {
  if (res.headersSent) return;

  if (err?.type === 'GEMMA_UNAVAILABLE') {
    console.error(`[error] GEMMA_UNAVAILABLE on ${req.method} ${req.originalUrl}: ${err.message}`);
    return sendError(res, 503, 'GEMMA_UNAVAILABLE', GEMMA_UNAVAILABLE_MESSAGE);
  }

  if (err?.type === 'RATE_LIMIT') {
    // Handled inside the route; this is a safety net if it ever escapes.
    console.error(`[error] RATE_LIMIT escaped to the error handler: ${err.message}`);
    return sendError(res, 503, 'GITHUB_RATE_LIMIT', GITHUB_RATE_LIMIT_MESSAGE);
  }

  if (err?.type === 'NETWORK' || err?.type === 'HTTP') {
    console.error(`[error] GitHub ${err.type} on ${req.method} ${req.originalUrl}: ${err.message}`);
    return sendError(res, 503, 'GITHUB_UNAVAILABLE', GITHUB_UNAVAILABLE_MESSAGE);
  }

  // express.json() body-parse failure.
  if (err?.type === 'entity.parse.failed') {
    return sendError(res, 400, 'INVALID_JSON', 'Request body is not valid JSON.');
  }

  console.error(`[error] UNHANDLED on ${req.method} ${req.originalUrl}:`, err);
  return sendError(
    res,
    500,
    'INTERNAL_ERROR',
    'Something went wrong while building matches. Check the backend logs.'
  );
});

/* ------------------------------------------------------------------ *
 * Startup
 * ------------------------------------------------------------------ */

const server = app.listen(PORT, async () => {
  console.log('');
  console.log('  RepoMatch API');
  console.log('  ────────────');
  console.log(`  port              : http://localhost:${PORT}`);
  console.log(`  GITHUB_TOKEN      : ${GITHUB_TOKEN ? 'set (higher rate limits)' : 'NOT set (anonymous: 10 searches/min, 60 req/hour)'}`);
  console.log(`  OLLAMA_URL        : ${OLLAMA_URL}`);
  console.log(`  gemma model       : ${GEMMA_MODEL}`);
  console.log(`  max repos analyzed: ${MAX_ANALYZED_REPOS} (sequential, local model)`);
  console.log(`  CORS origins      : ${CORS_ORIGINS.join(', ')} (+ any localhost port)`);
  console.log('');

  // Report Gemma health immediately so the team sees problems at boot.
  const health = await checkGemma();
  if (health.ollama && health.gemma) {
    console.log(`  [health] Gemma ready — model "${health.model}" is installed and Ollama is up.`);
  } else if (health.ollama) {
    console.warn(`  [health] Ollama is running but "${health.model}" is NOT installed.`);
    console.warn(`  [health] POST /api/matches will return 503 until you run:  ollama pull ${health.model}`);
    console.warn(`  [health] Installed models: ${(health.installed || []).join(', ') || 'none'}`);
  } else {
    console.warn(`  [health] Ollama is unreachable at ${OLLAMA_URL} (${health.error || 'no response'}).`);
    console.warn(`  [health] Start it with:  ollama serve`);
  }
  console.log(`  [health] GET http://localhost:${PORT}/api/health`);
  console.log('');
});

/**
 * Friendly startup failures. Without this, Express throws a raw
 * `Unhandled 'error' event` stack, which is the single most common
 * beginner stumble for this project.
 */
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ✖ Port ${PORT} is already in use — RepoMatch cannot start.\n`);
    console.error('    Fix it with one of:');
    console.error(`      lsof -ti:${PORT} | xargs kill -9`);
    console.error(`      PORT=3001 npm run dev`);
    console.error('    (Or stop whatever is already using the port.)\n');
  } else if (err.code === 'EACCES') {
    console.error(`\n  ✖ Permission denied binding port ${PORT}. Ports below 1024 need elevated privileges.\n`);
  } else {
    console.error(`\n  ✖ Server failed to start: ${err.message}\n`);
  }
  process.exit(1);
});

/* Graceful shutdown so nodemon restarts do not leave the port bound. */
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n[server] ${signal} received, shutting down`);
    server.close(() => process.exit(0));
    // Hard exit if a connection refuses to close.
    setTimeout(() => process.exit(0), 2000).unref();
  });
}

/* A stray rejection should never take the whole server down silently. */
process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandled promise rejection:', reason);
});

export default app;
