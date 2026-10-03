/**
 * matchRoutes.js — the single pipeline endpoint.
 *
 * POST /api/matches
 *   validate
 *     -> cache check
 *     -> githubService.searchRepositories      (fallback to demo data on ANY GitHub error)
 *     -> githubService.attachGoodFirstIssues    (top candidates only)
 *     -> matchingService.pickTopCandidates      (deterministic pre-filter, 5 max)
 *     -> gemmaService.analyzeRepositoriesSequential
 *     -> drop repos with no good-first issues
 *     -> merge + sort by matchScore desc
 *     -> respond (and cache for 10 minutes)
 */

import { Router } from 'express';
import {
  searchRepositories,
  attachGoodFirstIssues,
  clearSearchCache,
} from '../services/githubService.js';
import { getDemoRepositories } from '../services/demoData.js';
import { pickTopCandidates, MATCHING_RUBRIC, MAX_ANALYZED_REPOS } from '../services/matchingService.js';
import {
  checkGemma,
  analyzeRepositoriesSequential,
  GEMMA_UNAVAILABLE_MESSAGE,
} from '../services/gemmaService.js';
import { CACHE_TTL_MS, GITHUB_TOKEN } from '../services/config.js';

const router = Router();

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
    return res.status(400).json({ error: validation.message, code: 'INVALID_PROFILE' });
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
      return res.status(503).json({ error: GEMMA_UNAVAILABLE_MESSAGE, code: 'GEMMA_UNAVAILABLE' });
    }

    /* 4. repositories: GitHub, falling back to demo data -------------- */
    let dataSource = 'github';
    let repos = [];
    let searchCacheHit = false;

    try {
      const search = await searchRepositories(profile);
      repos = search.repos;
      searchCacheHit = search.cached;
      if (repos.length === 0) {
        console.warn('[github] 0 repos returned, falling back to demo data');
        repos = getDemoRepositories();
        dataSource = 'demo';
      }
    } catch (err) {
      // RATE_LIMIT, NETWORK, HTTP — all of them are invisible to the client.
      console.warn(`[github] search failed (${err?.type || 'UNKNOWN'}): ${err?.message || err} — using demo data`);
      repos = getDemoRepositories();
      dataSource = 'demo';
    }

    /* 5. good-first issues for the strongest candidates -------------- */
    // The pre-filter needs issue counts, so we do a cheap first pass, fetch
    // issues for the top slice, then re-rank with the real data.
    if (dataSource === 'github') {
      const preRanked = pickTopCandidates(repos, profile, MAX_ANALYZED_REPOS * 2);
      try {
        await attachGoodFirstIssues(preRanked);
      } catch (err) {
        if (err?.type === 'RATE_LIMIT') {
          console.warn(`[github] ${err.message} during issue fetch — using demo data`);
          repos = getDemoRepositories();
          dataSource = 'demo';
        } else {
          throw err;
        }
      }
      if (dataSource === 'github') {
        // pickTopCandidates returns shallow copies, and attachGoodFirstIssues
        // mutates those copies. Swap each enriched copy back into the pool so
        // the issue lists survive; the original objects are discarded.
        const enrichedById = new Map(preRanked.map((r) => [r.id, r]));
        repos = repos.map((r) => enrichedById.get(r.id) || r);
      }
    }

    console.log(`[matches] dataSource=${dataSource}, candidate pool=${repos.length}`);

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
      // Nothing to analyse. Return a well-formed empty result rather than 500,
      // and point the frontend at demo data if GitHub was the source.
      console.warn('[matches] no candidate has a good-first issue — returning empty result');
      return res.status(200).json({
        repositories: [],
        meta: { dataSource, aiSource: 'fallback', cached: false },
      });
    }

    /* 7. Gemma analysis, strictly sequential -------------------------- */
    const { results, anyFallback, anyGemma } = await analyzeRepositoriesSequential(profile, topCandidates);

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

    const aiSource = anyGemma ? 'gemma' : 'fallback';
    const payload = {
      repositories,
      meta: {
        dataSource,
        aiSource: anyFallback && anyGemma ? 'gemma' : aiSource,
        cached: false,
      },
    };

    console.log(
      `[matches] responding with ${repositories.length} repos (dataSource=${dataSource}, aiSource=${payload.meta.aiSource}) ` +
        `in ${((Date.now() - requestStarted) / 1000).toFixed(1)}s`
    );
    if (searchCacheHit) console.log('[matches] note: GitHub search results came from the 10-minute cache');

    /* 9. cache the final response ------------------------------------- */
    // A degraded result (demo data + deterministic scoring, i.e. no live GitHub
    // and no live model) is deliberately NOT cached. It means GitHub was rate
    // limited, and that usually clears within minutes — the next request for
    // the same profile should get the real thing instead of being stuck with a
    // cached placeholder for 10 minutes. Everything else caches for the full
    // TTL.
    const degraded = payload.meta.dataSource === 'demo' && payload.meta.aiSource === 'fallback';
    if (degraded) {
      console.log('[cache] skipping cache for a degraded (demo + fallback) result so the next call retries live sources');
    } else {
      writeCache(cacheKey, payload);
    }

    return res.status(200).json(payload);
  } catch (err) {
    return next(err);
  }
});

export default router;
export { cacheKeyFor, validateProfile };
