/**
 * matchRoutes.js — the single pipeline endpoint.
 *
 * POST /api/matches — LIVE DATA ONLY.
 *
 * Every repository and every issue returned comes from the real GitHub API.
 * There is no sample/demo dataset: if GitHub cannot be reached or is rate
 * limited, the request fails with an actionable error instead of returning
 * fabricated repositories.
 *
 *   validate
 *     -> cache check
 *     -> checkGemma                          -> 503 if the model is unavailable
 *     -> githubService.searchRepositories     (3 parallel calls, merged + deduped)
 *          -> relaxed retry if the strict query matched nothing
 *     -> githubService.attachGoodFirstIssues  (top candidates only)
 *     -> matchingService.pickTopCandidates    (deterministic pre-filter, 5 max)
 *     -> gemmaService.analyzeRepositoriesSequential
 *     -> drop repos with no good-first issues
 *     -> merge + sort by matchScore desc
 *     -> respond (and cache for 10 minutes)
 */

import { Router } from 'express';
import {
  searchRepositories,
  searchRepositoriesRelaxed,
  attachGoodFirstIssues,
  clearSearchCache,
} from '../services/githubService.js';
import { pickTopCandidates, MATCHING_RUBRIC, MAX_ANALYZED_REPOS } from '../services/matchingService.js';
import {
  checkGemma,
  analyzeRepositoriesSequential,
  GEMMA_UNAVAILABLE_MESSAGE,
} from '../services/gemmaService.js';
import { CACHE_TTL_MS } from '../services/config.js';
import { sendError } from '../services/httpError.js';

const router = Router();

/**
 * RepoMatch serves LIVE data only — there is no demo/sample fallback and no
 * fabricated repositories.
 *
 * When GitHub is unreachable or rate limited we cannot produce real
 * repositories, so we fail loudly with an actionable message instead of
 * inventing data. The frontend renders a dedicated "GitHub temporarily limited
 * repository discovery" state for any error whose code mentions github/rate.
 */
export const GITHUB_RATE_LIMIT_MESSAGE =
  'GitHub rate limit reached while searching for repositories. Add a GITHUB_TOKEN to backend/.env to raise the limit, then try again.';
export const GITHUB_UNAVAILABLE_MESSAGE =
  'Could not reach the GitHub API while searching for repositories. Check your internet connection, then try again.';

/* ------------------------------------------------------------------ *
 * Final-response cache (10 min TTL)
 * ------------------------------------------------------------------ */

/** @type {Map<string, {value: object, expiresAt: number}>} */
const responseCache = new Map();

/**
 * Stable cache key: profile fields are lower-cased and sorted so that
 * ["React","Node.js"] and ["node.js","react"] share one cache entry.
 */
function cacheKeyFor(profile) {
  const sorted = (list) => [...new Set((list || []).map((v) => String(v).trim().toLowerCase()))].sort();
  return JSON.stringify({
    skills: sorted(profile.skills),
    interests: sorted(profile.interests),
    experience: String(profile.experience || '').toLowerCase(),
  });
}

function readCache(key) {
  const hit = responseCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    responseCache.delete(key);
    return null;
  }
  return hit.value;
}

function writeCache(key, value) {
  responseCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  console.log(`[cache] stored match response (${responseCache.size} entr${responseCache.size === 1 ? 'y' : 'ies'})`);
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** Console-friendly preview of a profile for the pipeline logs. */
function profileLabel(profile) {
  return `${profile.experience} dev [${profile.skills.join(', ')}] interested in [${profile.interests.join(', ')}]`;
}

/**
 * Validate the request body.
 * @returns {{ok: true, profile: object} | {ok: false, message: string}}
 */
function validateProfile(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, message: 'Request body must be a JSON object.' };
  }

  const skills = body.skills;
  if (!Array.isArray(skills) || skills.length === 0) {
    return { ok: false, message: 'skills is required and must be a non-empty array of strings.' };
  }
  const cleanSkills = skills
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)
    .slice(0, 15);
  if (cleanSkills.length === 0) {
    return { ok: false, message: 'skills must contain at least one non-empty string.' };
  }

  const rawInterests = body.interests;
  const cleanInterests = Array.isArray(rawInterests)
    ? rawInterests
        .map((i) => (typeof i === 'string' ? i.trim() : ''))
        .filter(Boolean)
        .slice(0, 10)
    : [];

  const experience = String(body.experience || 'beginner').trim().toLowerCase();
  if (!['beginner', 'intermediate', 'advanced'].includes(experience)) {
    return {
      ok: false,
      message: 'experience must be one of: beginner, intermediate, advanced.',
    };
  }

  return { ok: true, profile: { skills: cleanSkills, interests: cleanInterests, experience } };
}

/** Merge a normalized repo + Gemma analysis into the exact client shape. */
function toClientRepository(repo, analysis) {
  return {
    id: repo.id,
    name: repo.name,
    fullName: repo.fullName,
    owner: repo.owner,
    description: repo.description,
    url: repo.url,
    stars: repo.stars,
    forks: repo.forks,
    language: repo.language,
    topics: repo.topics,
    goodFirstIssueCount: Array.isArray(repo.issues) ? repo.issues.length : repo.goodFirstIssues || 0,
    matchScore: analysis.matchScore,
    whyMatch: analysis.whyMatch,
    recommendedIssue: analysis.recommendedIssue,
    summary: analysis.summary,
  };
}

/**
 * Router mounted at /api by server.js, so the paths inside it are relative:
 *   POST   /api/matches
 *   DELETE /api/cache
 */

/** Exposed so a teammate can clear caches without restarting the server. */
router.delete('/cache', (_req, res) => {
  responseCache.clear();
  clearSearchCache();
  console.log('[cache] cleared response + search caches');
  res.json({ status: 'ok', cleared: ['response', 'search'] });
});

/* ------------------------------------------------------------------ *
 * POST /api/matches
 * ------------------------------------------------------------------ */

router.post('/matches', async (req, res, next) => {
  const requestStarted = Date.now();

  /* 1. validate ------------------------------------------------------ */
  const validation = validateProfile(req.body);
  if (!validation.ok) {
    console.warn(`[matches] 400 INVALID_PROFILE — ${validation.message}`);
    return sendError(res, 400, 'INVALID_PROFILE', validation.message);
  }
  const profile = validation.profile;

  const cacheKey = cacheKeyFor(profile);

  /* 2. cache check --------------------------------------------------- */
  const cached = readCache(cacheKey);
  if (cached) {
    console.log(`[matches] cache HIT for ${profileLabel(profile)}`);
    return res.status(200).json({ ...cached, meta: { ...cached.meta, cached: true } });
  }
  console.log(`[matches] profile: ${profileLabel(profile)}`);

  try {
    /* 3. Gemma availability gate ------------------------------------
     * Checked before any expensive work so a missing model fails in ~100ms
     * instead of after 30s of GitHub calls. NOTE: the client sends the
     * profile inside the request body, so /api/health is for startup and
     * for the frontend's own status badge.                            */
    const health = await checkGemma();
    if (!health.ollama || !health.gemma) {
      console.warn(`[matches] 503 GEMMA_UNAVAILABLE — ollama=${health.ollama} gemma=${health.gemma}`);
      return sendError(res, 503, 'GEMMA_UNAVAILABLE', GEMMA_UNAVAILABLE_MESSAGE);
    }

    /* 4. repositories: live GitHub, no fabricated data ---------------- */
    // RepoMatch only ever returns real repositories. If GitHub cannot be
    // reached we surface that as an error instead of substituting samples.
    let repos = [];
    let searchCacheHit = false;

    try {
      const search = await searchRepositories(profile);
      repos = search.repos;
      searchCacheHit = search.cached;
      if (repos.length === 0) {
        // A successful search that matched nothing is not an error, but the
        // qualifiers were too strict to be useful, so widen the net and retry
        // once before giving up.
        console.warn('[github] 0 repos matched the strict query — retrying with relaxed qualifiers');
        const relaxed = await searchRepositoriesRelaxed(profile);
        repos = relaxed.repos;
        searchCacheHit = relaxed.cached;
      }
    } catch (err) {
      const rateLimited = err?.type === 'RATE_LIMIT';
      console.warn(
        `[matches] GitHub search failed (${err?.type || 'UNKNOWN'}): ${err?.message || err}`
      );
      return sendError(
        res,
        503,
        rateLimited ? 'GITHUB_RATE_LIMIT' : 'GITHUB_UNAVAILABLE',
        rateLimited ? GITHUB_RATE_LIMIT_MESSAGE : GITHUB_UNAVAILABLE_MESSAGE
      );
    }

    /* 5. good-first issues for the strongest candidates -------------- */
    // The pre-filter needs issue counts, so we do a cheap first pass, fetch
    // issues for the top slice, then re-rank with the real data.
    const preRanked = pickTopCandidates(repos, profile, MAX_ANALYZED_REPOS * 2);
    try {
      await attachGoodFirstIssues(preRanked);
    } catch (err) {
      // A rate limit here means we cannot know which repos have real issues,
      // so we must not return half-verified results.
      const rateLimited = err?.type === 'RATE_LIMIT';
      console.warn(`[matches] issue fetch failed (${err?.type || 'UNKNOWN'}): ${err?.message || err}`);
      return sendError(
        res,
        503,
        rateLimited ? 'GITHUB_RATE_LIMIT' : 'GITHUB_UNAVAILABLE',
        rateLimited ? GITHUB_RATE_LIMIT_MESSAGE : GITHUB_UNAVAILABLE_MESSAGE
      );
    }

    // pickTopCandidates returns shallow copies, and attachGoodFirstIssues
    // mutates those copies. Swap each enriched copy back into the pool so
    // the issue lists survive; the original objects are discarded.
    const enrichedById = new Map(preRanked.map((r) => [r.id, r]));
    repos = repos.map((r) => enrichedById.get(r.id) || r);

    console.log(`[matches] live GitHub candidate pool=${repos.length}`);

    /* 6. deterministic pre-filter -> top 5 --------------------------- */
    const topCandidates = pickTopCandidates(repos, profile, MAX_ANALYZED_REPOS).filter(
      // Gemma can only recommend an issue that exists.
      (repo) => Array.isArray(repo.issues) && repo.issues.length > 0
    );
    console.log(
      `[matching] pre-filter kept ${topCandidates.length}/${repos.length} for Gemma ` +
        `(rubric: skill 30, topic 25, good-first 20, activity 10, stars 15 — max ${MATCHING_RUBRIC.maxCandidates})`
    );

    if (topCandidates.length === 0) {
      // A real search that legitimately produced nothing we can recommend is
      // not an error — an empty deck is an honest answer and the frontend has
      // an empty state for it.
      console.warn('[matches] no candidate had an open good-first issue — returning an empty deck');
      return res.status(200).json({
        repositories: [],
        meta: { dataSource: 'github', aiSource: 'gemma', cached: false },
      });
    }

    /* 7. Gemma analysis, strictly sequential -------------------------- */
    const { results, anyGemma } = await analyzeRepositoriesSequential(profile, topCandidates);

    /* 8. drop repos with no issues + merge + sort ---------------------- */
    const repositories = topCandidates
      // Belt and braces: a repo with no good-first issue can never be a valid
      // swipe target.
      .filter((repo) => Array.isArray(repo.issues) && repo.issues.length > 0)
      .map((repo) => {
        const analysis = results.get(repo.id);
        if (!analysis) return null;
        return toClientRepository(repo, analysis);
      })
      .filter(Boolean)
      .sort((a, b) => b.matchScore - a.matchScore);

    // dataSource is always "github": every repository here is real, fetched
    // live from the GitHub API. aiSource is "fallback" only when Ollama was up
    // but an individual call failed, in which case the scoring is
    // deterministic rather than model-generated — the repository data itself
    // is still real and comes straight from GitHub.
    const payload = {
      repositories,
      meta: {
        dataSource: 'github',
        aiSource: anyGemma ? 'gemma' : 'fallback',
        cached: false,
      },
    };

    console.log(
      `[matches] responding with ${repositories.length} live repos (aiSource=${payload.meta.aiSource}) ` +
        `in ${((Date.now() - requestStarted) / 1000).toFixed(1)}s`
    );
    if (searchCacheHit) console.log('[matches] note: GitHub search results came from the 10-minute cache');

    /* 9. cache the final response ------------------------------------- */
    writeCache(cacheKey, payload);

    return res.status(200).json(payload);
  } catch (err) {
    return next(err);
  }
});

export default router;
export { cacheKeyFor, validateProfile, toClientRepository };
