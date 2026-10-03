/**
 * matchingService.js — deterministic pre-filter that runs BEFORE Gemma.
 *
 * Purpose: a small local model is slow (5-15s per call), so we must hand it
 * only the handful of repositories that are most likely to be a good match.
 * This score is intentionally cheap and explainable — it is NOT the score the
 * user sees. Gemma's matchScore (0-100) is the final, authoritative number.
 *
 * Scoring rubric (max 100):
 *   +30  skill / language match
 *   +25  topic / interest match
 *   +20  has open good-first issues
 *   +10  recently active / has open issues
 *   +15  star count fits the developer's experience level
 */

import { MAX_ANALYZED_REPOS } from './config.js';

/** Star-range expectations per experience level. */
const STAR_PREFERENCE = {
  beginner: { min: 50, max: 5000, label: '50-5k stars' },
  intermediate: { min: 50, max: 20000, label: '50-20k stars' },
  advanced: { min: 0, max: Infinity, label: 'any size' },
};

/**
 * Reuse the GitHub vocabulary so the deterministic scorer agrees with what was
 * actually searched for.
 */
import { SKILL_TO_LANGUAGE, INTEREST_TO_TOPIC } from './githubService.js';

/** Normalise a free-text list into lower-cased, de-punctuated tokens. */
function tokenize(values = []) {
  return values
    .filter((v) => typeof v === 'string')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
    .flatMap((v) => [v, v.replace(/[^a-z0-9+#.]+/g, ' ').trim()])
    .filter(Boolean);
}

/** Words that appear in `skills` but are never a programming language. */
const NON_LANGUAGE_WORDS = new Set([
  'beginner', 'intermediate', 'advanced', 'junior', 'senior', 'learning', 'basics',
  'html/css', 'frontend', 'backend', 'fullstack', 'full stack', 'devops',
]);

/** Languages the developer could reasonably contribute in (lower-cased). */
function resolveLanguages(profile) {
  const skills = Array.isArray(profile?.skills) ? profile.skills : [];
  const languages = new Set();
  for (const skill of skills) {
    const raw = String(skill).trim();
    const key = raw.toLowerCase();
    if (!raw || NON_LANGUAGE_WORDS.has(key)) continue;
    // Prefer the curated GitHub mapping; fall back to the literal skill name so
    // an unmapped language ("Elixir", "Zig") still scores against the repo.
    // Everything is lower-cased so it compares cleanly with repo.language.
    languages.add((SKILL_TO_LANGUAGE[key] || raw).toLowerCase());
  }
  return languages;
}

/** GitHub topics the developer's interests point at. */
function resolveTopics(profile) {
  const interests = Array.isArray(profile?.interests) ? profile.interests : [];
  const topics = new Set();
  for (const interest of interests) {
    const mapped = INTEREST_TO_TOPIC[String(interest).toLowerCase().trim()];
    if (mapped) topics.add(mapped);
  }
  return topics;
}

/**
 * Score a single candidate against a profile.
 *
 * @param {object} repo   normalized repo (see githubService.normalizeRepo)
 * @param {{skills?:string[], interests?:string[], experience?:string}} profile
 * @returns {number} integer 0..100
 */
export function scoreCandidate(repo, profile) {
  if (!repo) return 0;
  let score = 0;

  const language = String(repo.language || '').toLowerCase();
  const languages = resolveLanguages(profile);
  const topics = resolveTopics(profile);

  /* +30 — skill / language match ------------------------------------- */
  // GitHub collapses React, Node.js and Express onto JavaScript, so a primary
  // language hit is the strongest single signal available here.
  if (language && languages.has(language)) {
    score += 30;
  } else {
    // Reduced credit when the skill only shows up as a repo topic
    // (e.g. a Python repo tagged `react` for its frontend directory).
    const repoTopics = (repo.topics || []).map((t) => String(t).toLowerCase());
    const hit = [...languages].some((l) => repoTopics.includes(String(l).toLowerCase()));
    if (hit) score += 15;
  }

  /* +25 — topic / interest match -------------------------------------- */
  const repoTopics = (repo.topics || []).map((t) => String(t).toLowerCase());
  const matchedTopics = [...topics].filter((t) => repoTopics.includes(String(t).toLowerCase()));
  if (matchedTopics.length > 0) {
    // One interest hit is worth 15; each additional one adds 5, capped at 25.
    score += Math.min(25, 15 + (matchedTopics.length - 1) * 5);
  } else {
    // Partial credit when a repo topic merely resembles an interest
    // (e.g. interest "Machine Learning" vs topic "machine-learning-tools").
    const interestTokens = tokenize(profile.interests);
    const looseHit = interestTokens.some(
      (token) => token.length > 3 && repoTopics.some((t) => t.includes(token) || token.includes(t))
    );
    if (looseHit) score += 10;
  }

  /* +20 — has good-first issues --------------------------------------- */
  const goodFirstCount =
    Array.isArray(repo.issues) && repo.issues.length > 0 ? repo.issues.length : repo.goodFirstIssues || 0;
  if (goodFirstCount > 0) score += 20;

  /* +10 — recently active --------------------------------------------- */
  const pushedAt = repo.pushedAt ? new Date(repo.pushedAt).getTime() : 0;
  const daysSincePush = pushedAt ? (Date.now() - pushedAt) / 86400000 : Infinity;
  const openIssues = repo.openIssues ?? 0;
  if (daysSincePush <= 7) score += 10;
  else if (daysSincePush <= 30) score += 7;
  else if (daysSincePush <= 90) score += 3;
  // A backlog of open issues means there is somewhere to contribute.
  if (openIssues > 0 && daysSincePush <= 30) score += 2;

  /* +15 — star-range compatibility ------------------------------------ */
  const level = String(profile?.experience || 'beginner').toLowerCase();
  const pref = STAR_PREFERENCE[level] || STAR_PREFERENCE.beginner;
  const stars = repo.stars ?? 0;
  if (stars >= pref.min && stars <= pref.max) {
    score += 15;
  } else if (stars > pref.max) {
    // Too big for the stated level, but only mildly penalised: active large
    // repos still have accessible good-first issues.
    score += 6;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Pick the strongest candidates to send to Gemma.
 *
 * @param {object[]} repos
 * @param {object} profile
 * @param {number} [limit]
 * @returns {object[]} best-first, each with a `_preFilterScore` field attached
 */
export function pickTopCandidates(repos, profile, limit = MAX_ANALYZED_REPOS) {
  return [...repos]
    .map((repo) => ({ ...repo, _preFilterScore: scoreCandidate(repo, profile) }))
    .sort((a, b) => {
      if (b._preFilterScore !== a._preFilterScore) return b._preFilterScore - a._preFilterScore;
      // Stable, meaningful tie-break: more good-first issues, then more stars.
      const gfa = b.issues?.length || b.goodFirstIssues || 0;
      const gfb = a.issues?.length || a.goodFirstIssues || 0;
      if (gfa !== gfb) return gfa - gfb;
      return (b.stars || 0) - (a.stars || 0);
    })
    .slice(0, limit);
}

/** Exposed so routes can log the rubric in one place. */
export const MATCHING_RUBRIC = {
  maxCandidates: MAX_ANALYZED_REPOS,
  weights: {
    skillLanguage: 30,
    topicInterest: 25,
    goodFirstIssues: 20,
    recentActivity: 10,
    starFit: 15,
  },
};

// Re-exported so routes only need one import from this module.
export { MAX_ANALYZED_REPOS };

export default {
  scoreCandidate,
  pickTopCandidates,
  MATCHING_RUBRIC,
  MAX_ANALYZED_REPOS,
};
