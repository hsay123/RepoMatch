/**
 * gemmaService.js — integration with a locally hosted Gemma model via Ollama.
 *
 * Ollama API surface used:
 *   GET  {OLLAMA_URL}/api/tags   -> list installed models (health check)
 *   POST {OLLAMA_URL}/api/chat   -> structured JSON scoring for one repo
 *
 * Design rules that the rest of the app depends on:
 *   - Calls are SEQUENTIAL. A small local model on a laptop chokes on parallel
 *     requests; the health endpoint exists precisely because of that.
 *   - Nothing that Ollama "thinks" ever reaches the client. Reasoning blocks
 *     are stripped from the raw text before parsing, and only validated fields
 *     from the parsed JSON are propagated.
 *   - Titles and URLs always come from the REAL issue list, never from the
 *     model, so a hallucinated issue number cannot produce a broken link.
 *   - If Ollama is down or the model is missing we throw
 *     { type: 'GEMMA_UNAVAILABLE' }. We never silently degrade in that case.
 *   - If Ollama is up but a single call fails or returns malformed JSON, we
 *     return a safe deterministic fallback and mark it via `usedFallback`.
 */

import { GEMMA_MODEL, OLLAMA_URL, GEMMA_TIMEOUT_MS, OLLAMA_HEALTH_TIMEOUT_MS } from './config.js';

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

/** Typed error so the route can map it to a 503 without string matching. */
function gemmaUnavailable(message) {
  const err = new Error(message);
  err.type = 'GEMMA_UNAVAILABLE';
  return err;
}

export const GEMMA_UNAVAILABLE_MESSAGE =
  'Local Gemma is not available. Start Ollama and make sure gemma4:e2b is installed.';

/* ------------------------------------------------------------------ *
 * Health check
 * ------------------------------------------------------------------ */

/**
 * Check Ollama and whether the configured model is actually installed.
 *
 * @returns {Promise<{ollama: boolean, gemma: boolean, model: string, installed?: string[], error?: string}>}
 */
export async function checkGemma() {
  const model = GEMMA_MODEL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_HEALTH_TIMEOUT_MS);

  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, { signal: controller.signal });
    if (!response.ok) {
      return {
        ollama: false,
        gemma: false,
        model,
        error: `Ollama responded ${response.status} ${response.statusText}`,
      };
    }

    const data = await response.json();
    const installed = Array.isArray(data?.models)
      ? data.models.map((m) => m?.name).filter(Boolean)
      : [];

    // Ollama reports names with a ":tag" suffix; a bare "gemma4:e2b" tag must
    // match a model whose name *starts with* that string.
    const gemma = installed.some((name) => String(name).startsWith(model));

    return { ollama: true, gemma, model, installed };
  } catch (err) {
    return {
      ollama: false,
      gemma: false,
      model,
      error: err?.name === 'AbortError' ? 'Ollama health check timed out' : err?.message || String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Throw if Gemma cannot be used. Called once at the start of a matches request. */
async function assertGemmaAvailable() {
  const health = await checkGemma();
  if (!health.ollama) {
    throw gemmaUnavailable(GEMMA_UNAVAILABLE_MESSAGE);
  }
  if (!health.gemma) {
    throw gemmaUnavailable(
      `${GEMMA_UNAVAILABLE_MESSAGE} (Ollama is running but "${GEMMA_MODEL}" is not in: ${(health.installed || []).join(', ') || 'no models'})`
    );
  }
  return health;
}

/* ------------------------------------------------------------------ *
 * Prompts
 * ------------------------------------------------------------------ */

const SYSTEM_PROMPT = `You are RepoMatch's matching engine for open-source contribution.
You receive one developer profile and one GitHub repository, and you decide how good a first contribution would be.

ABSOLUTE OUTPUT RULES:
- Respond with ONLY valid JSON. No markdown. No code fences. No comments.
- No explanation, no prose, no reasoning, no chain of thought outside the JSON.
- Never invent issue numbers. Only use an issue number that appears in the provided list.
- Keep every string on a single line and under 220 characters.`;

/**
 * Build the user prompt. Kept compact on purpose — every token costs latency
 * on a local model.
 */
function buildUserPrompt(profile, repo) {
  const skills = (profile.skills || []).join(', ') || 'not specified';
  const interests = (profile.interests || []).join(', ') || 'not specified';
  const experience = profile.experience || 'beginner';

  // The issue number is presented as a labelled field rather than as list index
  // "#302", because models routinely confuse "the 2nd issue listed" with the
  // actual issue number when both forms of position are present.
  const issueLines = (repo.issues || []).length
    ? repo.issues
        .map(
          (issue) =>
            `- issue number: ${issue.number}\n  title: ${issue.title}\n  labels: ${(issue.labels || []).join(', ') || 'none'}\n  body: ${(issue.body || 'no description').slice(0, 220)}`
        )
        .join('\n')
    : 'No issues are available.';

  return `DEVELOPER PROFILE
skills: ${skills}
interests: ${interests}
experience: ${experience}

REPOSITORY
name: ${repo.fullName}
description: ${repo.description || 'none'}
primary language: ${repo.language || 'unknown'}
topics: ${(repo.topics || []).join(', ') || 'none'}
stars: ${repo.stars}
open issues: ${repo.openIssues ?? 0}

OPEN GOOD-FIRST ISSUES
Each entry below lists an "issue number". Copy that exact integer into
recommendedIssue.number. Never use a position in this list as the number.
${issueLines}

TASK
Score how well this repository fits this developer, then pick the single best starter issue.

Return exactly this JSON object and nothing else:
{
  "matchScore": <integer 0-100, 50 = decent, 80+ = excellent first contribution>,
  "whyMatch": ["<short reason>", "<short reason>", "<short reason>"],
  "recommendedIssue": {
    "number": <MUST be copied verbatim from an "issue number" above>,
    "difficulty": "Beginner" | "Intermediate" | "Advanced",
    "skills": ["<skill>", "<skill>"]
  },
  "summary": "<one sentence, max 200 chars, on what the developer would do here>"
}`;
}

/* ------------------------------------------------------------------ *
 * JSON parsing
 * ------------------------------------------------------------------ */

/**
 * Tolerant JSON extraction from a model response.
 *
 * Handles three real-world failure modes:
 *   1. reasoning blocks emitted despite the prompt asking for none
 *   2. ```json fenced output
 *   3. a sentence before or after the JSON object
 *
 * @param {string} text
 * @returns {object|null}
 */
export function safeParseJson(text) {
  if (typeof text !== 'string' || !text.trim()) return null;

  /** @type {string[]} */
  const candidates = [text];

  // 1. Reasoning blocks emitted despite the prompt asking for none.
  //    The second expression also handles a block that was never closed.
  const withoutThink = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/i, '');
  if (withoutThink !== text) candidates.push(withoutThink);

  // 2. Every variant of the text, with reasoning removed.
  const bases = [text, withoutThink];

  for (const base of bases) {
    // 3. Strip markdown code fences (```json ... ``` or ``` ... ```).
    const fenced = base.replace(/```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/g, '$1');
    candidates.push(fenced);

    // 4. Slice from the first "{" to the last "}" — removes any chatty
    //    preamble or trailing commentary around the object.
    const start = fenced.indexOf('{');
    const end = fenced.lastIndexOf('}');
    if (start !== -1 && end > start) {
      candidates.push(fenced.slice(start, end + 1));
    }
  }

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

/** Force a value into a finite integer inside [min, max]. */
function clampScore(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.min(100, Math.round(num)));
}

const DIFFICULTIES = new Set(['Beginner', 'Intermediate', 'Advanced']);

/** Coerce anything into an array of non-empty strings. */
function toStringArray(value, maxItems = 6, maxLen = 220) {
  const list = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? [value]
      : [];
  return list
    .map((v) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''))
    .map((v) => v.replace(/\s+/g, ' ').trim().slice(0, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

/** Collapse whitespace and hard-cap a model-written string. */
function cleanModelString(value, maxLen) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

/**
 * Validate the model's JSON against reality and build the final analysis.
 *
 * @param {object|null} parsed         raw model output
 * @param {object} repo                normalized repo with real issues
 * @param {number} preFilterScore      deterministic score used as the fallback
 * @param {{skills?:string[], interests?:string[]}} profile
 * @returns {{matchScore:number, whyMatch:string[], recommendedIssue:object, summary:string, usedFallback:boolean}}
 */
export function validateAnalysis(parsed, repo, preFilterScore, profile) {
  const issues = Array.isArray(repo?.issues) ? repo.issues : [];
  const fallbackIssue = issues[0] || null;

  /* ---- recommendedIssue: ALWAYS sourced from the real issue list ---- */
  let issue = null;
  let issueMatched = false;

  const claimedNumber = Number(parsed?.recommendedIssue?.number ?? parsed?.issueNumber);
  if (Number.isFinite(claimedNumber)) {
    issue = issues.find((i) => Number(i.number) === claimedNumber) || null;
    issueMatched = Boolean(issue);
  }
  if (!issue) {
    // Hallucinated or missing number -> fall back to the first real issue.
    issue = fallbackIssue;
  }

  // The model may still classify difficulty/skills for the issue it picked.
  const rawDifficulty = parsed?.recommendedIssue?.difficulty;
  const difficulty =
    typeof rawDifficulty === 'string' && DIFFICULTIES.has(rawDifficulty.trim())
      ? rawDifficulty.trim()
      : inferDifficulty(issue, profile);

  const recommendedIssue = {
    title: issue ? issue.title : 'No open good-first issue right now',
    number: issue ? issue.number : 0,
    url: issue ? issue.url : repo?.url || '',
    difficulty,
    skills: issue ? toStringArray(parsed?.recommendedIssue?.skills, 5, 60) : [],
  };
  // An empty skills array is unhelpful; fall back to the profile's own skills.
  if (recommendedIssue.skills.length === 0) {
    recommendedIssue.skills = toStringArray(profile?.skills, 5, 60);
  }

  /* ---- matchScore ------------------------------------------------- */
  const score = clampScore(parsed?.matchScore);
  if (score === null) {
    return fallbackAnalysis(repo, preFilterScore, profile, 'model returned no usable matchScore');
  }

  /* ---- whyMatch --------------------------------------------------- */
  const whyMatch = toStringArray(parsed?.whyMatch, 4);
  if (whyMatch.length === 0) {
    return fallbackAnalysis(repo, preFilterScore, profile, 'model returned no reasons', {
      matchScore: score,
      recommendedIssue,
    });
  }

  /* ---- summary ---------------------------------------------------- */
  const summary =
    cleanModelString(parsed?.summary, 280) ||
    cleanModelString(
      `${repo.fullName} is a ${repo.language || 'multi-language'} project with open good-first issues that line up with your skills.`,
      280
    );

  return {
    matchScore: score,
    whyMatch,
    recommendedIssue,
    summary,
    // usedFallback = true only when we had to substitute a hallucinated or
    // missing issue number, or fell back to a deterministic reason list.
    usedFallback: !issueMatched,
  };
}

/** Heuristic difficulty label when the model did not give a usable one. */
function inferDifficulty(issue, profile) {
  if (!issue) return 'Beginner';
  const level = String(profile?.experience || 'beginner').toLowerCase();
  const labels = (issue.labels || []).map((l) => String(l).toLowerCase());
  if (labels.some((l) => l.includes('easy') || l.includes('starter') || l.includes('beginner'))) {
    return 'Beginner';
  }
  if (labels.some((l) => l.includes('hard') || l.includes('complex') || l.includes('expert'))) {
    return 'Advanced';
  }
  if (level === 'advanced') return 'Advanced';
  if (level === 'beginner') return 'Beginner';
  return 'Intermediate';
}

/**
 * Deterministic result used when the model misbehaves but Ollama is up.
 * Built entirely from real repo data + the pre-filter score, so it is always
 * truthful even when Gemma failed.
 */
export function fallbackAnalysis(repo, preFilterScore, profile, reason, overrides = {}) {
  const issues = Array.isArray(repo?.issues) ? repo.issues : [];
  const issue = issues[0] || null;
  const skills = new Set((profile?.skills || []).map((s) => String(s)));

  const whyMatch = [];

  const language = String(repo?.language || '').toLowerCase();
  const skillHit = (profile?.skills || []).find((s) =>
    String(s).toLowerCase().includes(language) || language.includes(String(s).toLowerCase())
  );
  if (skillHit) whyMatch.push(`Your ${skillHit} skills line up with this ${repo.language} project.`);

  const topics = (repo?.topics || []).map((t) => String(t).toLowerCase());
  const interestHit = (profile?.interests || []).find((i) =>
    topics.some((t) => t.includes(String(i).toLowerCase().replace(/\s+/g, '-')) || String(i).toLowerCase().includes(t))
  );
  if (interestHit) whyMatch.push(`It is tagged for ${interestHit}, which you listed as an interest.`);

  if (issues.length > 0) {
    whyMatch.push(
      `${issues.length} open good-first issue${issues.length > 1 ? 's' : ''} you can pick up without prior context.`
    );
  }
  if (repo?.openIssues > 0) {
    whyMatch.push(`Active project with ${repo.openIssues} open issues, so maintainers are responsive.`);
  }
  if (whyMatch.length === 0) {
    whyMatch.push(`${repo?.fullName || 'This repository'} is an active project that accepts outside contributions.`);
  }

  const matchScore = overrides.matchScore ?? clampScore(preFilterScore) ?? 50;
  const recommendedIssue = overrides.recommendedIssue ?? {
    title: issue ? issue.title : 'No open good-first issue right now',
    number: issue ? issue.number : 0,
    url: issue ? issue.url : repo?.url || '',
    difficulty: inferDifficulty(issue, profile),
    skills: [...skills].slice(0, 5),
  };

  return {
    matchScore,
    whyMatch: whyMatch.slice(0, 4),
    recommendedIssue,
    summary:
      `${repo?.fullName || 'This repository'} (${repo?.language || 'multi-language'}, ${repo?.stars ?? 0} stars) ` +
      `is a practical place to start: ${issues.length > 0 ? 'it has issues scoped for newcomers' : 'it is actively looking for contributors'}.`,
    usedFallback: true,
    fallbackReason: reason,
  };
}

/* ------------------------------------------------------------------ *
 * Analysis
 * ------------------------------------------------------------------ */

/**
 * Score one repository with Gemma, with full validation and a safe fallback.
 *
 * @param {object} profile
 * @param {object} repo
 * @param {number} [preFilterScore]
 * @returns {Promise<{matchScore:number, whyMatch:string[], recommendedIssue:object, summary:string, usedFallback:boolean, usedGemma:boolean, durationMs:number}>}
 */
export async function analyzeRepository(profile, repo, preFilterScore = 50) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMMA_TIMEOUT_MS);

  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: GEMMA_MODEL,
        stream: false,
        format: 'json', // Ollama's grammar-constrained JSON mode.
        think: false, // never generate reasoning blocks
        options: { temperature: 0.2 },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(profile, repo) },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      // 404 here means "model not found" -> that is an availability problem.
      if (response.status === 404) {
        throw gemmaUnavailable(
          `${GEMMA_UNAVAILABLE_MESSAGE} (Ollama responded 404 for model "${GEMMA_MODEL}")`
        );
      }
      console.warn(`[gemma] ${repo.fullName}: Ollama responded ${response.status} — ${body.slice(0, 200)}`);
      return {
        ...fallbackAnalysis(repo, preFilterScore, profile, `http ${response.status}`),
        usedGemma: false,
        durationMs: Date.now() - started,
      };
    }

    const data = await response.json();
    // message.content is the answer. We never read message.thinking or any
    // other field, so model reasoning cannot leak into the response.
    const content = typeof data?.message?.content === 'string' ? data.message.content : '';
    const parsed = safeParseJson(content);

    if (!parsed) {
      console.warn(`[gemma] ${repo.fullName}: could not parse JSON, using deterministic fallback`);
      return {
        ...fallbackAnalysis(repo, preFilterScore, profile, 'unparseable JSON'),
        usedGemma: false,
        durationMs: Date.now() - started,
      };
    }

    const validated = validateAnalysis(parsed, repo, preFilterScore, profile);
    if (validated.usedFallback) {
      console.warn(`[gemma] ${repo.fullName}: model proposed an invalid issue number, corrected to a real one`);
    }
    return { ...validated, usedGemma: true, durationMs: Date.now() - started };
  } catch (err) {
    // Availability problems must bubble up as typed errors so the route can 503.
    if (err?.type === 'GEMMA_UNAVAILABLE') throw err;
    if (err?.name === 'AbortError') {
      console.warn(`[gemma] ${repo.fullName}: timed out after ${GEMMA_TIMEOUT_MS}ms, using deterministic fallback`);
      return {
        ...fallbackAnalysis(repo, preFilterScore, profile, 'timeout'),
        usedGemma: false,
        durationMs: Date.now() - started,
      };
    }
    console.warn(`[gemma] ${repo.fullName}: call failed (${err?.message || err}), using deterministic fallback`);
    return {
      ...fallbackAnalysis(repo, preFilterScore, profile, 'request failed'),
      usedGemma: false,
      durationMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Analyze several repositories SEQUENTIALLY.
 *
 * Sequential is deliberate: concurrent requests to a small local model on a
 * laptop queue in Ollama and increase total latency, sometimes to the point of
 * timeouts.
 *
 * @param {object} profile
 * @param {object[]} repos
 * @returns {Promise<{results: Map<number, object>, anyFallback: boolean, anyGemma: boolean, totalMs: number}>}
 */
export async function analyzeRepositoriesSequential(profile, repos) {
  const results = new Map();
  let anyFallback = false;
  let anyGemma = false;
  const started = Date.now();

  console.log(`[gemma] analyzing ${repos.length} repos sequentially with ${GEMMA_MODEL}`);

  for (let i = 0; i < repos.length; i += 1) {
    const repo = repos[i];
    console.log(`[gemma] analyzing ${i + 1}/${repos.length}: ${repo.fullName}`);
    const result = await analyzeRepository(profile, repo, repo._preFilterScore);
    if (result.usedGemma) anyGemma = true;
    else anyFallback = true;
    if (result.fallbackReason) {
      console.log(`[gemma]   ${repo.fullName} used fallback (${result.fallbackReason})`);
    }
    console.log(`[gemma] ${repo.fullName} done in ${(result.durationMs / 1000).toFixed(1)}s -> score ${result.matchScore}`);
    results.set(repo.id, result);
  }

  console.log(`[gemma] all analyses finished in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return { results, anyFallback, anyGemma, totalMs: Date.now() - started };
}

export default {
  checkGemma,
  analyzeRepository,
  analyzeRepositoriesSequential,
  safeParseJson,
  validateAnalysis,
  fallbackAnalysis,
  GEMMA_UNAVAILABLE_MESSAGE,
};
